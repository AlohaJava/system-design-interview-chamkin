# Разбор задачи: проектирование CI/CD системы (свой GitHub Actions)

> **Формулировка на собеседовании:** «Спроектируй распределённую CI/CD систему в стиле GitHub Actions: система реагирует на `git push`, читает YAML-описание workflow из репозитория, планирует и выполняет джобы в изолированном окружении и стримит логи и статусы пользователю в реальном времени».
>
> Задача встречается на собеседованиях в Meta, OpenAI, Stripe и крупных российских компаниях (в формате «спроектируй систему сборки/деплоя»). Это одна из лучших задач для проверки понимания очередей, оркестрации, идемпотентности и fault tolerance — всё это «настоящая» распределённая система, а не CRUD с кэшем.

## Почему задача сложнее, чем звучит

Наивный ответ («вебхук → сервер → bash-скрипт») разваливается на первом же follow-up вопросе. Реальные сложности, которые интервьюер будет нащупывать:

- **10k+ одновременных пайплайнов**, всплески нагрузки ×10 (merge train в понедельник утром, ночные регрессии).
- **Multi-tenancy и fairness**: сотни команд на одной платформе, нельзя дать одному репозиторию «съесть» весь кластер (noisy neighbor).
- **Воркеры падают посреди джобы** — нужны retry, таймауты, отмена без «зомби» и без двойного выполнения.
- **Логи и статусы в реальном времени** — пользователь ждёт `tail -f` в браузере, а джоба может писать тысячи строк в секунду.
- **Секреты, артефакты, кэш, изоляция** — безопасность и воспроизводимость сборок.

Типичные deep-dive вопросы интервьюера (реальные формулировки из разборов):

- «Несколько пользователей запушили одновременно — как оркеструешь и приоритизируешь сборки, чтобы минимизировать задержки?»
- «Команды делят одну платформу — как изолируешь пайплайны, обеспечиваешь fairness и защищаешься от noisy neighbor?»
- «Будешь ли делать артефакты иммутабельными? Как тогда обеспечить воспроизводимость и инвалидацию кэша?»
- «Как спроектируешь безопасный rollback в мультисервисном окружении без каскадных падений?»
- «Расскажи по шагам, как работает retry: что пишется в БД, что видит пользователь, как не выполнить джобу дважды?»

## Уточняющие вопросы интервьюеру

Не начинайте рисовать, пока не зафиксировали рамки. Хороший набор вопросов (2–3 минуты):

1. **Триггеры**: только `git push`, или ещё PR, ручной запуск, cron/schedule, API-триггер? (Ответ влияет на ingestion-слой.)
2. **Источник конфигурации**: YAML в репозитории (как GitHub Actions) или UI/DSL? — берём YAML в репо, pinned на commit SHA.
3. **Масштаб**: сколько pushes/sec, сколько одновременных джоб, сколько организаций-тенантов?
4. **Изоляция**: достаточно контейнеров или нужна VM-изоляция (недоверенный код из публичных репо)?
5. **Результаты**: нужно ли хранить артефакты сборки и как долго? Нужен ли кэш зависимостей?
6. **Наблюдаемость**: логи в реальном времени — обязательны или «посмотреть после завершения» достаточно? (Обязательны — это отдельный deep dive.)
7. **Деплой (CD)**: входит ли деплой в скоуп, или проектируем только CI (build/test)? — обычно договариваются: CI в скоупе, CD обозначить как расширение.

## Требования

### Functional

| # | Требование | Суть |
|---|-----------|------|
| F1 | Триггер workflow по `git push` | Принять webhook, скачать YAML из коммита, распарсить, запланировать |
| F2 | Изолированное выполнение джоб | Каждая джоба в своём sandbox (контейнер/microVM), секреты — scoped, только нужному шагу |
| F3 | Видимость в реальном времени | Live-статусы шагов, стриминг логов, быстрый фидбек об ошибках |
| F4 | Retry, таймауты, отмена | Политики повторов, принудительное завершение зависших джоб, отмена workflow |
| F5 | Артефакты и кэш | Сохранение результатов сборки, версионирование, скачивание |

### Non-functional

| # | Требование | Целевое значение |
|---|-----------|------------------|
| N1 | Масштаб | 10k одновременных workflow в steady state, до 100k в пике |
| N2 | Изоляция | падение/«злой» скрипт одной джобы не влияет на другие |
| N3 | Fairness | per-tenant квоты, защита от noisy neighbor |
| N4 | Durability | состояние (статусы, логи, артефакты) переживает падение любого компонента; джоба восстанавливается или корректно ретраится |
| N5 | Низкая задержка триггера | от `git push` до постановки в очередь ≤ 10 сек даже в пике |

## Оценки нагрузки (back-of-envelope)

Исходные допущения — проговорите их вслух и зафиксируйте с интервьюером:

- **10 pushes/sec** → `10 × 86400 ≈ 864k workflow runs/день`.
- Средняя длительность workflow — **15 минут** → concurrency = `10/s × 900s ≈ 9k ≈ 10k активных runs` (закон Литтла: `L = λ × W`).
- В одном workflow в среднем **7 джоб**, часть параллельно → одновременно выполняется **~15–20k задач**, в пике (×10, merge trains, ночные регрессии) — **100k+**.
- **Логи**: джоба пишет в среднем ~50 строк/сек × ~200 байт → `20k × 50 × 200B ≈ 200 MB/s` в steady state, ~1–2 GB/s в пике. За день — порядка 10–15 TB сырых логов, после gzip (×10) — ~1–1.5 TB/день. Kafka справляется с таким потоком на обычном кластере.
- **Артефакты**: 20% runs сохраняют ~100 MB → `864k × 0.2 × 100MB ≈ 17 TB/день`; retention 30 дней → ~0.5 PB в объектном хранилище. Это нормально для S3-подобного стора.
- **Метаданные**: на run ~7 джоб × ~2 попытки × ~4 перехода состояний ≈ 50–60 строк в БД → **~50M строк/день**. Значит, таблицы попыток и событий нужно партиционировать по времени и чистить/архивировать по TTL.
- **SLO триггера**: провайдер вебхуков (GitHub) ждёт ответ ~10 сек, но повторяет доставку при любом сбое → ACK надо отдавать за ≤ 2 сек, всё тяжёлое — асинхронно.

Эти числа сразу дают три архитектурных следствия: (1) ingestion должен быть асинхронным и буферизованным; (2) одна глобальная очередь не выдержит — нужны шардированные очереди; (3) состояние нельзя держать в памяти планировщика — нужна durable metadata DB.

## API

```http
# Вход от git-провайдера (не публичный API, но критичный интерфейс)
POST /webhooks/github
Headers: X-Hub-Signature-256: sha256=..., X-GitHub-Delivery: <uuid>
Body: { "ref": "refs/heads/main", "after": "<commit_sha>", "repository": {...} }
→ 202 Accepted   # сразу, без синхронной обработки

# Публичный API платформы
GET  /v1/runs?repo=org/app&branch=main&status=failed&limit=20
GET  /v1/runs/{run_id}                      # статус workflow + джоб
POST /v1/runs/{run_id}/cancel               # идемпотентная отмена
POST /v1/runs/{run_id}/rerun                # перезапуск (failed only / all)
GET  /v1/runs/{run_id}/jobs/{job_id}/logs   # SSE-стрим live-логов
GET  /v1/artifacts/{artifact_id}            # redirect на signed URL (S3)
POST /v1/repos/{repo}/secrets               # запись секрета (write-only)
```

Ключевые решения, которые стоит озвучить:

- Webhook отвечает **202 Accepted**, а не 200 после обработки — «acknowledge first, process later». Это главный приём против таймаутов и ретраев провайдера.
- Логи — **SSE (Server-Sent Events)**, не WebSocket: однонаправленный стрим, дешевле держать тысячи соединений, автоматический reconnect с `Last-Event-ID`.
- Секреты — **write-only**: API позволяет записать/обновить, но не прочитать.

## High-level design

```mermaid
flowchart LR
    subgraph Producers["Источники событий"]
        Dev["Developer git push"]
        PR["Pull Request"]
        Cron["Nightly cron"]
    end

    GW["API Gateway auth HMAC rate limit"]
    DD["Dedup Redis SETNX"]
    WQ[("Webhook Queue Kafka")]
    ING["Ingress Service parse validate build DAG"]
    GF["Git Fetcher shallow clone by SHA"]
    MDB[("Metadata DB PostgreSQL")]
    SCH["Scheduler ready tasks"]
    ORCH["Central Orchestrator"]
    JQ[("Partitioned Job Queue by tenant shard")]
    AS["Autoscaler and hot shard detector"]
    REC["Reconciler timeout manager"]

    subgraph Workers["Runner Fleet stateless"]
        W1["Runner pool spot"]
        W2["Runner pool on demand"]
    end

    S3[("Object Storage S3 artifacts logs raw webhooks")]
    LQ[("Log Ingestion Queue Kafka")]
    PS["Pub/Sub Redis"]
    UI["Web UI SSE"]
    SI[("Search Index logs")]

    Dev --> GW
    PR --> GW
    Cron --> SCH
    GW --> DD --> WQ --> ING
    ING --> GF
    ING --> MDB
    ING -.->|"raw webhook replay log"| S3
    SCH --> MDB
    SCH --> ORCH --> JQ
    JQ --> W1
    JQ --> W2
    AS --> JQ
    AS --> Workers
    REC --> MDB
    W1 --> LQ
    W2 --> LQ
    W1 -->|"artifacts"| S3
    W2 -->|"artifacts"| S3
    LQ --> PS --> UI
    LQ --> S3
    LQ --> SI
    W1 -->|"status heartbeat"| MDB
    W2 -->|"status heartbeat"| MDB
```

Система делится на четыре плоскости — это удобный каркас для рассказа:

1. **Ingestion**: API Gateway → дедупликация → очередь вебхуков → ingress-сервис (fetch YAML → валидация → построение DAG → persist).
2. **Orchestration**: scheduler находит готовые к запуску задачи в DAG, orchestrator раздаёт их воркерам через шардированные очереди; reconciler следит за таймаутами.
3. **Execution**: stateless-воркеры, каждая джоба в изолированном sandbox, секреты scoped, квоты на CPU/RAM/network.
4. **Observability**: логи и статусы текут через Kafka, fanout в UI (SSE) и в durable storage (S3 + поисковый индекс).

## Поток данных: от `git push` до запланированного workflow

```mermaid
sequenceDiagram
    autonumber
    participant D as Developer
    participant G as Git Provider
    participant A as API Gateway
    participant R as Redis Dedup
    participant K as Kafka Webhook Queue
    participant I as Ingress Service
    participant F as Git Fetcher
    participant M as Metadata DB
    participant S as Scheduler

    D->>G: git push
    G->>A: POST webhook plus HMAC signature plus delivery id
    A->>A: verify HMAC SHA256 signature
    A->>R: SETNX delivery id TTL 72h
    alt duplicate delivery
        R-->>A: key exists
        A-->>G: 202 Accepted skip
    else first delivery
        R-->>A: OK
        A->>K: enqueue raw event
        A-->>G: 202 Accepted within 2s
        A->>I: async consume
        I->>K: poll event
        I->>F: fetch workflow yaml pinned to commit SHA
        F-->>I: yaml content
        I->>I: validate and parse into DAG
        I->>M: insert workflow_run plus tasks
        M-->>S: poll ready tasks
    end
```

Разбор блоков (именно так стоит рассказывать — «нарезаем требование на блоки и прикладываем принципы к каждому»):

1. **Аутентификация**: HMAC-SHA256 подпись вебхука (схема GitHub) — защита от spoofing и replay.
2. **Дедупликация**: провайдер гарантирует *at least once* и ретраит доставку → ключ `delivery_id` (у GitHub — `X-GitHub-Delivery` GUID) + commit SHA в Redis с TTL 72ч. Это даёт эффективную семантику *exactly once* на уровне бизнес-логики, не требуя её от транспорта.
3. **Асинхронность**: ACK за ≤2 сек, тяжёлая работа (fetch, парсинг, построение DAG) — после постановки в Kafka. Очередь — shock absorber: даже если scheduler перегружен или перезапускается, события не теряются.
4. **Durability first**: план запуска (run + tasks) персистится в metadata DB **до** того, как хоть одна задача будет запланирована — переживаем падение посреди ingestion.
5. **Replay-лог**: каждый сырой webhook дополнительно пишется в S3 (аудит, отладка, возможность перепроиграть события в Kafka после инцидента).

## Модель данных

Сущности выводятся из потока, а не придумываются заранее: смотрим, что должно сохраняться между блоками. Три базовые сущности + три вспомогательные:

```mermaid
erDiagram
    WORKFLOW_RUN ||--|{ TASK : contains
    TASK ||--|{ TASK_ATTEMPT : executed_by
    TASK_ATTEMPT ||--|{ EXECUTION_EVENT : emits
    TASK_ATTEMPT ||--o{ ARTIFACT : produces
    TASK_ATTEMPT ||--o{ LOG_CHUNK : writes

    WORKFLOW_RUN {
        uuid run_id PK
        string repo
        string commit_sha
        string branch
        string status
        timestamp created_at
        timestamp deadline
    }
    TASK {
        uuid task_id PK
        uuid run_id FK
        string name
        string container_image
        json resource_needs
        json depends_on
        int max_retries
        int timeout_sec
    }
    TASK_ATTEMPT {
        uuid attempt_id PK
        uuid task_id FK
        int retry_count
        string status
        string worker_id
        timestamp started_at
        timestamp deadline
        string log_path
        int exit_code
    }
    EXECUTION_EVENT {
        bigint event_id PK
        uuid attempt_id FK
        string from_status
        string to_status
        timestamp at
    }
    ARTIFACT {
        uuid artifact_id PK
        uuid attempt_id FK
        string s3_path
        string type
        string sha256
        timestamp expires_at
    }
    LOG_CHUNK {
        uuid chunk_id PK
        uuid attempt_id FK
        bigint seq_no
        string s3_path
        timestamp created_at
    }
```

Зачем каждая сущность:

- **`workflow_run`** — «мастер-запись» запуска: один push → один run, привязан к repo + commit SHA. Пин YAML на SHA даёт воспроизводимость: rerun старого пайплайна использует ровно тот же конфиг.
- **`task`** — узел DAG из YAML: образ, ресурсы, рёбра зависимостей (`depends_on`), политика retry/timeout.
- **`task_attempt`** — *каждая фактическая попытка* выполнения, включая ретраи. Это ключевое решение: без отдельной строки на попытку ретраи выглядят как «тихие переисполнения» — теряется история, аудит и защита от гонок (старая попытка не может писать, см. fencing ниже).
- **`execution_event`** — append-only журнал всех переходов состояний (`pending → running → failed → ...`). Источник истины для аудита и восстановления после падения orchestrator'а.
- **`artifact`**, **`log_chunk`** — связь выходов джобы с объектным хранилищем: путь, тип, хэш, TTL.

Практические замечания: партиционируем `task_attempt` и `execution_event` по времени (50M строк/день), архив холодных runs — в S3. Для «живых» данных хватит PostgreSQL; нагрузка на запись — десятки тысяч TPS в пике, что для шардированного Postgres приемлемо.

## Deep dive 1: надёжный ingestion под всплесками

Сценарий: 10:00 утра, десятки инженеров запушили в `main`, систему засыпало вебхуками. Три риска:

| Риск | Причина | Решение |
|------|---------|---------|
| Потеря событий | сервер упал до персиста; провайдер stateless и «не помнит» доставку | ACK только после записи в Kafka; replay-лог сырых вебхуков в S3 |
| Дубликаты | провайдер ретраит при любом сбое/таймауте | дедупликация по `delivery_id` в Redis (SETNX, TTL 72ч) |
| Таймаут ответа | fetch + валидация + планирование до ответа | 202 Accepted сразу; тяжёлая работа асинхронно |

Важно озвучить: «провайдер вебхуков — stateless, он не помнит, что доставил, и будет ретраить, если мы не ответили быстро». Отсюда весь дизайн блока.

## Deep dive 2: планировщик, очереди задач и fairness

Почему наивный дизайн ломается на 100k одновременных джоб:

1. **Одна глобальная очередь** — единая точка contention, backlog растёт лавинообразно.
2. **Хаос координации** — джобы «перебронируются», молча падают, бесконечно рестартуют.
3. **Гонки в статусах** — два планировщика/ретрая переводят задачу `ready → running → ready` → двойное выполнение.
4. **Hot tenant** — один репозиторий флудит системой и душит остальных.

Решения:

### Шардированные очереди

Вместо одной очереди — партиции по `org_id` / `repo_id` или `hash(workflow_run_id)` (consistent hashing). Разные тенанты планируются независимо: нет общего bottleneck, нет starvation, нет crosstalk. Планировщики тянут из партиций параллельно.

### Ready-очередь вместо полного скана DAG

На каждом тике сканировать весь DAG — трата CPU. Вместо этого задача попадает в **ready queue только когда все её prerequisites завершились**. Это снижает задержку, экономит вычисления и позволяет делать per-tenant приоритизацию на уровне ready-очереди.

### Идемпотентные переходы состояний (CAS)

Каждый переход — compare-and-swap по текущему статусу:

```sql
-- воркер забирает задачу: успех только если она ещё ready
UPDATE task_attempt
SET status = 'running', worker_id = 'w-29', started_at = now()
WHERE attempt_id = 'a2' AND status = 'ready';
-- affected rows = 0 → кто-то уже забрал, пропускаем
```

Тот же приём — optimistic locking по версии строки. Это защита от двойного выполнения, устаревших апдейтов и гонок планировщиков. Сильная фраза для интервью: «все переходы состояний идемпотентны — повторная попытка с тем же намерением безвредна».

### Autoscaler + hot shard detector

Отдельный компонент следит за глубиной очередей, latency джоб, насыщением ресурсов и давлением по шардам:

- шард «горячего» репозитория троттлим (per-tenant квоты, weighted fair queuing);
- размер воркер-пулов масштабируется динамически (spot-пул для черновой нагрузки, on-demand для гарантированной);
- приоритеты по SLA (релизная ветка > фиче-ветка).

### Выбор брокера для очереди задач

| Критерий | Kafka | RabbitMQ | SQS |
|----------|-------|----------|-----|
| Модель | append-only log, consumer offset | умный брокер, ACK/NACK, routing | managed, visibility timeout |
| Порядок | внутри партиции | per queue | FIFO-очереди (с лимитом throughput) |
| Replay | да, из коробки | нет | нет |
| Throughput | очень высокий | средний | высокий (standard) |
| Когда брать | вебхуки, логи, события (нужен replay) | job queue с гибким routing и per-message ACK | минимум операционки |

Прагматичный ответ на собеседовании: **Kafka для потока событий и логов** (durability, ordering, replay), а для раздачи задач воркерам подойдёт и RabbitMQ/SQS-подобная очередь с per-message acknowledgement и visibility timeout — её семантика «взял → выполнил → ACK / не ACK → вернулось» прямо ложится на pull-модель раннеров. И ещё одна сильная формулировка из разборов Meta: **не обещайте exactly once** — честная позиция «at least once delivery + идемпотентные консьюмеры» звучит сильнее и соответствует продакшену.

## Deep dive 3: изоляция сборок и секреты

Каждая джоба исполняется в sandbox: запушенный код — недоверенный (в публичных репо — буквально чужой код на вашем железе).

| Подход | Изоляция | Старт | Overhead | Когда |
|--------|----------|-------|----------|-------|
| Контейнер (Docker/K8s pod) | namespace + cgroups, общее ядро | ~100 мс | минимальный | доверенные тенанты, внутренний CI |
| gVisor / Kata | прослойка между контейнером и ядром | ~сек | средний | компромисс |
| microVM (Firecracker) | свой kernel per VM | ~125 мс | ~5 MB памяти на VM | multi-tenant, публичные репо |

Референс: GitHub Actions для публичных репозиториев гоняет джобы на отдельных VM; AWS Lambda использует Firecracker. На собеседовании достаточно сказать: «контейнеры для внутренних тенантов, microVM — для недоверенного кода; выбор — trade-off между изоляцией и стоимостью».

Что ещё закрывает sandbox:

- **Квоты**: CPU, память, диск, network egress (whitelist) — ограничиваем blast radius «злого» или багнутого скрипта.
- **Pinned image**: образ по digest (`image@sha256:...`), а не по тегу — воспроизводимость.
- **Секреты**: scoped до конкретного шага, инъекция через короткоживущие токены (OIDC, как `id-token` в GitHub Actions), маскирование в логах, write-only API. Секреты организации ≠ секреты репозитория ≠ секреты environment.
- **Эфемерность**: окружение создаётся под джобу и уничтожается после — никакого состояния между runs, кроме явного кэша.

**Кэш и артефакты.** Артефакты — иммутабельные, версионированные по SHA, с TTL (`expires_at`) — это даёт воспроизводимость, безопасный rollback и аудит. Кэш зависимостей — отдельно: ключ = хэш lock-файла (`package-lock.json`, `go.sum`), инвалидация сменой ключа, а не удалением «по времени». Cache hit rate 80%+ даёт главное ускорение CI на практике — про это часто спрашивают follow-up'ом.

## Deep dive 4: durability — retry, таймауты, отмена

Масштаб бессмысленен, если оркестрация не durable. Четыре риска:

1. **Scheduler упал посреди run** → состояние в памяти потеряно, статусы неоднозначны.
2. **Retry затирает предыдущую попытку** → теряем историю и наблюдаемость.
3. **Зависшая джоба висит вечно** → утечка ресурсов, workflow никогда не завершится.
4. **Отменённый workflow «воскресает»** → поздний retry перезапускает то, что пользователь отменил.

Решения:

- **Всё состояние в metadata DB**: `workflow_run`, `task`, `task_attempt`, append-only `execution_event`. Scheduler stateless — после падения состояние полностью восстанавливается из БД.
- **Retry-политика в задаче**: `max_retries` (например 3–5), экспоненциальный backoff (1s → 2s → 4s → ...), разделение ошибок на retryable (network timeout, worker lost) и non-retryable (ошибка конфигурации YAML, failed test — нет смысла повторять). Каждый retry — **новая строка `task_attempt`**, старые попытки не затираются.
- **Reconciler (timeout manager)**: раз в 30–60 сек сканирует `SELECT ... WHERE status = 'running' AND deadline < now()`, применяет переходы `timeout`/`cancelled`. Даже если воркер испарился молча, система сама заметит «зомби».
- **Идемпотентная отмена**: run помечается `cancelled` в БД → запущенные джобы получают SIGTERM (grace ~10 сек на слив логов) → SIGKILL → downstream-задачи помечаются `skipped`. Все переходы пишутся как события; повторная отмена безвредна, поздний retry отменённой задачи отвергается CAS'ом.

### Жизненный цикл попытки (state machine)

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> ready : all prerequisites done
    pending --> skipped : upstream failed or cancelled
    ready --> running : CAS update if status equals ready
    running --> success : exit code 0
    running --> failed : non zero exit or heartbeat lost
    running --> timeout : reconciler sees deadline passed
    running --> cancelled : user cancel SIGTERM then SIGKILL
    failed --> ready : retry_count less than max_retries with backoff
    timeout --> ready : retryable timeout with backoff
    success --> [*] : unblock downstream tasks
    cancelled --> [*]
    skipped --> [*]
    failed --> [*] : retries exhausted mark run failed
```

### Пошаговый сценарий retry (тот самый вопрос «расскажи, как движутся данные»)

```mermaid
sequenceDiagram
    autonumber
    participant S as Scheduler
    participant M as Metadata DB
    participant Q as Partitioned Job Queue
    participant W1 as Worker w13
    participant R as Reconciler
    participant W2 as Worker w29

    S->>M: insert attempt A1 status running worker w13 deadline t0 plus 15m
    W1->>M: heartbeats every 10s
    Note over W1: worker crashes at t0 plus 30s
    R->>M: scan attempts where running and deadline passed or heartbeat stale
    R->>M: mark A1 failed append execution event
    R->>M: evaluate DAG retries left equals 2
    R->>Q: enqueue new attempt A2 retry_count 1 backoff 4s
    Q->>W2: dispatch A2
    W2->>M: CAS ready to running worker w29
    Note over W1,M: fencing old attempt A1 writes rejected
    W2->>M: exit code 0 status success logs uploaded
    S->>M: unblock downstream tasks in DAG
```

Три детали, которые отличают сильный ответ:

- **Fencing**: старой попытке (A1) запрещено писать — все апдейты фильтруются по `attempt_id`; даже если «мёртвый» воркер ожил, он не испортит состояние.
- **Heartbeat от воркеров**: orchestrator узнаёт о падении за ~30 сек, а не ждёт 15-минутного дедлайна.
- **Deadline хранится рядом с попыткой** — reconciler тупо сканирует индекс по `deadline`, ему не нужна внутренняя память. (В разборе distributed job scheduler используют тот же приём: индекс по run-timestamp даёт быстрый запрос «какие задачи пора запускать/ретраить», а исполнитель при захвате задачи продлевает отметку, чтобы задачу не ретраили, пока она честно работает.)

## Deep dive 5: логи и статусы в реальном времени

Разработчики хотят `tail -f` в браузере. Наивные подходы ломаются мгновенно: писать логи напрямую в БД — убьём IOPS (тысячи строк/сек на джобу); стримить воркер → клиент напрямую — лаг/дисконнект клиента теряет логи, а падение воркера уничтожает их навсегда.

Решение — **разделить ingestion, fanout и storage**:

```mermaid
flowchart LR
    subgraph Runner["Runner"]
        Job["Job stdout stderr"]
        LC["Log Collector batch tag attempt_id seq_no"]
    end
    LQ[("Log Ingestion Queue Kafka")]
    subgraph Fanout["Fanout"]
        PS["Redis Pub/Sub"]
        SSE["SSE Gateway debounce rate limit heartbeat"]
    end
    UI["Browser CLI"]
    S3[("S3 compressed chunks logs run task attempt stdout.log.gz")]
    SI[("Search Index structured queries")]

    Job --> LC --> LQ
    LQ --> PS --> SSE --> UI
    LQ -->|"persisted log chunks"| S3
    LQ --> SI
```

- **Ingestion**: воркер батчит строки каждые несколько секунд, тегирует `attempt_id + seq_no` и пишет в Kafka. Kafka даёт durability, порядок и replay: даже если все клиенты отключились, стрим не потерян.
- **Fanout**: из Kafka события разлетаются в Redis pub/sub; UI подписан через SSE. Апдейты дебаунсятся и rate-limit'ятся, heartbeat каждые несколько секунд держит соединение живым — клиент не захлёбывается, «зомби»-соединения не копятся.
- **Storage**: по завершении (или каждые N минут) логи сжимаются и укладываются в S3 по детерминированному пути `logs/{run_id}/{task_id}/{attempt_id}/stdout.log.gz` + дублируются в поисковый индекс для структурированных запросов («покажи ERROR по всем runs ветки за неделю»).
- **Статусы** — отдельный лёгкий канал: переходы состояний пишутся в БД и публикуются через pub/sub, UI обновляет бейджи шагов без чтения логов.

Фраза, которая хорошо завершает deep dive: «логи — это user experience CI/CD системы: если пользователь не видит, что происходит, система *ощущается* сломанной, даже если джобы выполняются».

## Trade-offs: сводная таблица

| Решение | Взяли | Альтернатива | Цена выбора |
|---------|-------|--------------|-------------|
| Модель раннеров | **Pull** (воркеры сами тянут задачи) | Push от orchestrator | нужны heartbeat и visibility timeout; зато естественный backpressure и простой autoscaling |
| Доставка событий | At least once + идемпотентность | Exactly once | exactly once дорог и хрупок; честная идемпотентность проще и надёжнее |
| Очередь задач | Шардированные партиции по тенанту | Одна глобальная FIFO | теряем строгий глобальный FIFO-порядок — он и не нужен между тенантами |
| Изоляция | Контейнеры (внутренние) + microVM (недоверенный код) | голые VM | VM — минуты на старт, контейнер — слабее изоляция; гибрид по уровню доверия |
| Метаданные | PostgreSQL (транзакции, CAS) | NoSQL | нужно шардировать и партиционировать вручную на 50M строк/день |
| Live-логи | SSE | WebSocket / polling | SSE только server→client (нам хватает), зато дёшево держать 100k соединений |
| Логи | Kafka → S3 + search index | прямая запись в БД | два хранилища = консистентность на приложении; зато БД не умирает под логами |
| Артефакты | Иммутабельные, versioned by SHA | перезаписываемые | больше storage (нужен TTL/GC), зато воспроизводимость и rollback |

## Красные флаги / типичные ошибки кандидатов

- **Рисовать полную диаграмму до требований и оценок.** Сигнал «заучил ответ». Сначала scope, числа, потом блоки.
- **Вывалить все детали сразу.** Ответ становится шумным и нечитаемым. Правильная тактика: идти по потоку, обозначать точки сложности и *предлагать* deep dive («логи стримим через Redis pub/sub, а персистим в S3 — про fanout и буферизацию на клиенте могу рассказать отдельно»). Это показывает, что вы видите сложность, но управляете фокусом.
- **Синхронная обработка вебхука.** Если вы делаете fetch + parse + schedule до ответа GitHub — получите ретраи, дубликаты и каскадный отказ в пике.
- **«Очередь гарантирует exactly once».** Без механизма и защиты формулировки это минус. Правильный ответ: at least once + идемпотентные переходы (CAS) + дедупликация на ingress.
- **Состояние в памяти scheduler'а.** Падение = потеря всего. Всё состояние — в metadata DB, scheduler stateless.
- **Одна глобальная очередь на всех.** Нет fairness, нет изоляции тенантов, единая точка contention.
- **Retry без отдельной попытки.** Затираете историю, не можете отличить flaky от стабильно падающего, старый воркер может перезаписать новое состояние (нет fencing).
- **Джобы без таймаутов.** Зомби-джобы едят кластер вечно. Нужен reconciler с дедлайнами.
- **Логи в БД или напрямую клиенту.** Умрёте по IOPS / потеряете логи при падении воркера.
- **Забыть, что код в джобе — недоверенный.** Без sandbox, квот и scoped-секретов дизайн непригоден для multi-tenant платформы.

## Что спросят дополнительно (follow-up вопросы)

- **Кэш сборки**: как устроен ключ кэша, как инвалидируете, как не дать одному тенанту отравить кэш другого? (Ключ = hash lock-файлов + OS + toolchain; кэш namespace'ится по репозиторию/ветке.)
- **Rollback в CD**: как откатить деплой в мультисервисном окружении без каскадных падений? (Иммутабельные артефакты + версионирование релизов, деплой обратной совместимостью N/N-1, canary + автоматический откат по метрикам, запрет «рассогласованных» откатов через явный release manifest.)
- **Merge queue / merge train**: как сериализовать проверки PR перед мерджем, не проверяя каждый по отдельности? (Очередь батчей, проверка «предиктивного» мердж-результата, eviction неудачного батча.)
- **Приоритеты**: как обеспечить, что hotfix в прод соберётся раньше ночной регрессии? (Приоритетные очереди внутри шарда, preemption или выделенный on-demand пул.)
- **Spot-инстансы**: что если воркер на spot отзовут посреди джобы? (Тот же механизм heartbeat + retry на другом воркере; чекпоинты кэша/артефактов для длинных сборок.)
- **Масштаб метаданных**: 50M строк/день в `task_attempt` — как жить? (Партиции по дате, TTL-архивация в S3, отдельная «горячая» таблица активных попыток для reconciler'а.)
- **Безопасность**: как не утечь секретом через логи? (Маскирование на стороне log collector, секреты только в env нужного шага, OIDC-токены вместо долгоживущих ключей.)
- **Self-hosted runners**: как встроить раннеры клиента в его VPC? (Pull-модель решает: раннер сам ходит наружу за задачами, inbound-доступ не нужен.)

## Как подавать ответ: 5-шаговый фреймворк

Из разбора ShowOffer — рабочая структура именно для таких «конвейерных» систем:

1. **Нарежьте функциональные требования на строительные блоки**: `git push → fetch YAML → validate → build DAG → persist → enqueue`. Это скелет, который не даёт прыгать между компонентами.
2. **Прикладывайте принципы к каждому блоку**: синхронно или асинхронно? какие гарантии durability и retry? нужна ли дедупликация, backpressure, fallback? Это показывает мышление инженера распределённых систем, а не «рисователя диаграмм».
3. **Выводите сущности из потока**: смотрите, какие данные должны сохраняться между блоками — так естественно рождаются `workflow_run`, `task`, `task_attempt`, а не угадываются заранее.
4. **Свяжите диаграммой**: даже текстовая схема с подписанными ответственностями и жизненным циклом `run → task → attempt → status → logs`.
5. **Вернитесь к deep dives** — не углубляйтесь раньше времени, а приглашайте интервьюера: «могу подробнее рассказать про retry и таймауты / про fanout логов / про fairness между тенантами — что интереснее?»

## Источники и видео по теме

- [Разработка системы CI/CD — популярный вопрос на собеседовании по OpenAI и Meta (ShowOffer)](https://www.youtube.com/watch?v=y32PywFi7Ek) — основной разбор: требования, 5-шаговый фреймворк подачи, дедупликация вебхуков, шардированные очереди, reconciler, retry/timeout-сценарии, стриминг логов.
- [Distributed Job Scheduler / Systems Design Interview Questions With Ex-Google SWE](https://www.youtube.com/watch?v=pzDwYHRzEnk) — смежная задача: индексация по run-timestamp, продление таймстемпа исполнителем против ложных ретраев, ограничение числа retry, партиционирование.
- [Очереди сообщений в системном дизайне на собеседованиях: советы от ведущего инженера Meta](https://www.youtube.com/watch?v=1ISRd0bS714) — гарантии доставки (at least once + идемпотентность как стандартный правильный ответ), почему не стоит обещать exactly once, выбор между SQS/RabbitMQ/Kafka.
