# Разбор задачи: система уведомлений (Notification System)

> Классическая задача на системный дизайн: спроектировать сервис, который доставляет уведомления пользователям по каналам push / email / SMS / in-app. Обманчиво простая формулировка скрывает целый ворох подводных камней: приоритизация, rate limiting, дедупликация, интеграция с внешними провайдерами (FCM, APNS, Twilio, SMTP) и трекинг доставки.
>
> Важный контекст, который сразу стоит озвучить интервьюеру: система уведомлений почти никогда не существует сама по себе — это встраиваемый компонент большой системы (e-commerce, банкинг, букинг). Поэтому хороший ответ строится как «платформа уведомлений для всей компании», а не как «скрипт, который шлёт пуши».

## Содержание

- [Уточняющие вопросы](#уточняющие-вопросы)
- [Требования](#требования)
- [Оценки нагрузки](#оценки-нагрузки)
- [API](#api)
- [High-level design](#high-level-design)
- [Модель данных](#модель-данных)
- [Deep dive](#deep-dive)
  - [1. Приоритетные очереди](#1-приоритетные-очереди)
  - [2. Per-user rate limiting и user preferences](#2-per-user-rate-limiting-и-user-preferences)
  - [3. Дедупликация и идемпотентность](#3-дедупликация-и-идемпотентность)
  - [4. Провайдеры, retry и трекинг доставки](#4-провайдеры-retry-и-трекинг-доставки)
  - [5. Шаблонизация](#5-шаблонизация)
- [Trade-offs](#trade-offs)
- [Красные флаги и типичные ошибки](#красные-флаги-и-типичные-ошибки)
- [Что спросят дополнительно](#что-спросят-дополнительно)
- [Источники и видео по теме](#источники-и-видео-по-теме)

---

## Уточняющие вопросы

Не начинайте рисовать архитектуру, пока не зафиксируете рамки. Сильный кандидат тратит первые 3–5 минут на вопросы:

1. **Какие каналы поддерживаем?** Push (iOS/Android), email, SMS, in-app? WhatsApp/Telegram — сейчас или «на будущее»? От ответа зависит требование pluggability.
2. **Кто отправитель?** Внутренние сервисы компании (заказ оформлен, платёж прошёл) или это SaaS-платформа для внешних клиентов? Для SaaS добавляется биллинг, квоты per-client и атрибуция.
3. **Какие типы уведомлений?** Транзакционные (OTP, подтверждение платежа) vs промо/маркетинговые. Это ключ к приоритизации и rate limiting.
4. **Требования к задержке?** OTP должен прийти за секунды; промо-рассылка может опоздать на полчаса — никто не заметит.
5. **Масштаб?** 10 тыс. уведомлений в день или 10 млн? Для малого масштаба всё честно собирается в один deployable сервис — и это стоит прямо сказать интервьюеру, это признак зрелости, а не слабости.
6. **Нужны ли scheduled / bulk-рассылки?** «Отправить всем, кто купил телевизор за последние сутки» — это отдельный сценарий со своим query engine.
7. **Нужен ли трекинг доставки и аудит?** Для банковского/юридического контекста — обязательно («нам могут предъявить, что мы не уведомили клиента»).
8. **Учитываем ли пользовательские настройки (opt-in/opt-out, quiet hours)?**

Сильная формулировка: «Предлагаю сфокусироваться на платформе для внутренних сервисов компании с каналами push/email/SMS, транзакционным и промо-трафиком, ~10 млн уведомлений в день. In-app inbox и bulk-рассылки обозначу, но вглубь пойду по основному pipeline».

---

## Требования

### Functional

- Отправка уведомлений по каналам: **push (iOS/Android), email, SMS, in-app**.
- Две модели запроса:
  - «отправь этот контент по этому адресу этим каналом» (external-style: клиент сам решает как);
  - «отправь это событие этому userId» (internal-style: платформа сама выбирает канал по предпочтениям пользователя).
- **Приоритизация**: high (OTP, security alerts) → medium (транзакционные) → low (промо).
- **Rate limiting**: per-user («не больше N промо в день») и per-client/per-API-key (для SaaS).
- **Шаблоны** с параметрами и версионированием.
- **Дедупликация**: одно бизнес-событие = одно уведомление на канал.
- **Retry с exponential backoff**, dead-letter queue для окончательно недоставленных.
- **Трекинг статусов**: accepted → sent → delivered → failed (+ аудит).
- User preferences: opt-in/opt-out по каналам и категориям, quiet hours.
- (Опционально) Bulk-рассылки по фильтру аудитории, scheduled отправки.

### Non-functional

| NFR | Комментарий |
|---|---|
| **Availability** | Высокая. Падение сервиса = пользователи не получают OTP и не могут залогиниться → прямые потери денег |
| **Latency** | High-priority: секунды end-to-end. Low-priority: минуты/час допустимы |
| **Durability** | Ни одно принятое уведомление не должно потеряться → persistence в очереди, а не in-memory |
| **Scalability** | Пики на порядок выше среднего (flash sale, массовый сбой, новогодняя рассылка) |
| **Pluggability** | Добавление нового канала (WhatsApp) = новый handler + новый топик, без переделки ядра |
| **At-least-once + идемпотентность** | Exactly-once недостижим end-to-end; честно проектируем под at-least-once с дедупликацией |

Ключевая мысль для интервьюера: **«мы не можем гарантировать exactly-once доставку до устройства, поэтому строим at-least-once pipeline и гасим дубликаты идемпотентностью»** — эта фраза сразу отделяет сеньора от джуна.

---

## Оценки нагрузки

Возьмём крупный продукт:

- **100 млн пользователей**, в среднем **5 уведомлений на пользователя в день** → **500 млн уведомлений/день**.
- Средний RPS: `500M / 86 400 ≈ 5 800 msg/s`.
- Пик (рассылки по часовым поясам, flash sale): **×5–10 от среднего → 30–60 тыс. msg/s**.
- Размер записи о статусе доставки ~1 КБ → `500M × 1KB ≈ 500 ГБ/день` трекинг-данных. Храним «горячими» 30 дней (~15 ТБ), дальше — в дешёвое холодное хранилище (S3/Parquet) для аудита.
- Более скромный сценарий (10 млн уведомлений/день): среднее ~115 msg/s, пик ~1–2 тыс. msg/s — тоже удобная цифра, чтобы показать, что вы умеете считать.

Выводы из цифр, которые стоит озвучить:

- Даже «скромные» 10 млн/день — это такая нагрузка, при которой наивное решение (синхронный HTTP-вызов провайдера прямо в request path) ломается: **без retry любой таймаут Twilio теряет сообщение, без rate limiting Firebase забанит ваш sender, без приоритетов маркетинговая рассылка задушит OTP**.
- Один инстанс worker'а обрабатывает сотни–тысячи msg/s → нужна очередь с горизонтально масштабируемыми консьюмерами (Kafka/SQS), партиционирование и backpressure.

---

## API

```http
POST /v1/notifications
Content-Type: application/json
X-Idempotency-Key: 9f2c1e7a-...
```

```json
{
  "userId": "u-12345",
  "templateId": "order_confirmed",
  "templateVersion": 3,
  "params": { "orderId": "A-987", "amount": "1290 RUB" },
  "channels": ["push", "email"],
  "priority": "high",
  "scheduledAt": null,
  "metadata": { "sourceService": "orders-api", "traceId": "..." }
}
```

Ответ — асинхронный `202 Accepted`:

```json
{ "notificationId": "n-abc-001", "status": "accepted" }
```

Принципиальный момент, который обсуждают в разборах: **синхронно не ждём реальной отправки**. Сервис валидирует запрос, кладёт событие в очередь и отвечает клиенту «принято, доставим в течение секунд». Синхронный вариант возможен только для узкого класса (например, OTP по явному требованию), но и там обычно async + быстрый путь.

Дополнительные эндпоинты:

```text
GET  /v1/notifications/{id}            # статус доставки по каналам
POST /v1/templates                     # CRUD шаблонов (admin)
GET  /v1/users/{id}/preferences        # opt-in/opt-out, quiet hours
PUT  /v1/users/{id}/preferences
POST /v1/bulk                          # фильтр аудитории + templateId
POST /v1/providers/webhooks/{vendor}   # delivery callbacks от Twilio/SES/FCM
```

---

## High-level design

```mermaid
flowchart LR
    subgraph Clients["Источники событий"]
        C1["Orders API"]
        C2["Payments API"]
        C3["Marketing / Bulk UI"]
    end

    GW["API Gateway + Auth"]
    NS["Notification Service<br/>(validate, idempotency)"]
    K1[("Kafka: notifications.incoming")]

    subgraph Pipeline["Processing Pipeline"]
        VP["Validator +<br/>User Preferences"]
        RL["Rate Limiter<br/>(Redis)"]
        PR["Prioritizer"]
        TS["Template Service"]
    end

    KH[("Kafka: notify.high")]
    KM[("Kafka: notify.medium")]
    KL[("Kafka: notify.low")]

    subgraph Senders["Channel Senders (workers)"]
        PS["Push Sender"]
        SS["SMS Sender"]
        ES["Email Sender"]
        IS["In-App Sender"]
    end

    subgraph Vendors["3rd-party Providers"]
        FCM["FCM / APNS"]
        TW["Twilio / SMS-агрегаторы"]
        SMTP["SES / SMTP"]
        WS["WebSocket gateway"]
    end

    DLQ[("DLQ / retry topics")]
    TRK["Delivery Tracker"]
    DB[("Cassandra:<br/>status & audit log")]
    UDB[("User prefs DB<br/>+ devices DB")]

    C1 --> GW
    C2 --> GW
    C3 --> GW
    GW --> NS --> K1
    K1 --> VP
    VP <--> UDB
    VP --> RL --> PR --> TS
    TS --> KH
    TS --> KM
    TS --> KL
    KH --> PS
    KH --> SS
    KM --> ES
    KL --> PS
    KL --> ES
    KH --> IS
    PS --> FCM
    SS --> TW
    ES --> SMTP
    IS --> WS
    PS -.->|retry| DLQ
    SS -.->|retry| DLQ
    ES -.->|retry| DLQ
    FCM --> TRK
    TW --> TRK
    SMTP --> TRK
    TRK --> DB
    NS -.->|accepted| DB
```

Ключевые архитектурные решения, которые нужно проговорить:

1. **Message queue между приоритизацией и сендерами — не опция, а необходимость.** Без очереди получаем жёсткую связность: если SMS-сервис тормозит, приоритизатор блокируется на ожидании и душит throughput всей системы; если сендер упал — уведомления «в полёте» теряются без шанса на переобработку. Очередь даёт: (а) развязку по скорости (сендер читает в своём темпе), (б) естественный retry (сообщение остаётся в топике, пока не обработано), (в) буфер на пики.
2. **Log-based брокер (Kafka), а не in-memory (Redis queue, Celery).** Kafka хранит сообщения на диске → можно replay'ить трафик после сбоя («email-сервис лежал сутки — проиграли партиции заново») и гарантированно ничего не терять. In-memory брокеры быстрее, но потерял ноду — потерял сообщения.
3. **Отдельный handler на канал** (push / SMS / email / in-app) как отдельно масштабируемые consumer group'ы. SMS медленный и дорогой — масштабируем независимо от email.
4. **Pluggability**: новый канал (WhatsApp) = новый тип сообщения + новый топик + новый handler. Ядро не трогаем.
5. **Масштаб диктует детализацию.** При низком throughput честно говорим: «всё это можно собрать в один deployable сервис с внутренними очередями — и я бы так и сделал на старте». Интервьюеры это ценят.

### Поток одного уведомления (sequence)

```mermaid
sequenceDiagram
    autonumber
    participant CL as Orders API
    participant NS as Notification Service
    participant KQ as Kafka incoming
    participant PP as Pipeline
    participant KP as Kafka priority topics
    participant SN as SMS Sender
    participant VD as Twilio
    participant TR as Delivery Tracker

    CL->>NS: POST /v1/notifications (idempotency-key)
    NS->>NS: проверить idempotency-key в Redis
    NS->>KQ: publish event
    NS-->>CL: 202 Accepted (notificationId)
    KQ->>PP: consume
    PP->>PP: validate, prefs, rate limit, priority
    PP->>KP: publish to notify.high
    KP->>SN: consume (consumer group sms-senders)
    SN->>TR: mark SENT
    SN->>VD: HTTP send (timeout 3s)
    alt успех
        VD-->>SN: 200 OK (provider message id)
        VD->>TR: webhook DELIVERED
        SN->>KQ: commit offset
    else таймаут / 5xx
        VD--xSN: error
        SN->>SN: не коммитим offset, retry с backoff
        Note over SN,KP: после N попыток — в DLQ
    end
```

Обратите внимание на деталь, которую любят проверять: **offset в Kafka коммитим только после подтверждения провайдера** (или после записи «отправлено» в трекер) — иначе падение воркера между отправкой и коммитом приведёт к потере, а падение между коммитом и отправкой — к дублю. Отсюда — требование идемпотентности на каждом шаге (см. deep dive 3).

---

## Модель данных

```mermaid
erDiagram
    USERS ||--o{ DEVICES : has
    USERS ||--|| USER_PREFS : configures
    TEMPLATES ||--o{ TEMPLATE_VERSIONS : versions
    NOTIFICATIONS ||--o{ DELIVERY_ATTEMPTS : tracks
    NOTIFICATIONS }o--|| TEMPLATE_VERSIONS : renders
    CLIENTS ||--o{ NOTIFICATIONS : sends

    USERS {
        uuid user_id PK
        string email
        string phone
        string locale
        string timezone
    }
    DEVICES {
        uuid device_id PK
        uuid user_id FK
        string platform "ios | android | web"
        string push_token
        timestamp token_updated_at
        boolean is_active
    }
    USER_PREFS {
        uuid user_id PK
        jsonb channel_opt_in "push:true, email:true, sms:false"
        jsonb category_opt_in "promo:false, tx:true"
        string quiet_hours "22:00-08:00"
    }
    TEMPLATES {
        uuid template_id PK
        string name "order_confirmed"
        string channel "push | email | sms"
        uuid client_id FK
    }
    TEMPLATE_VERSIONS {
        uuid version_id PK
        uuid template_id FK
        int version
        string locale
        text body "Заказ {{orderId}} на {{amount}}"
        string subject
        string status "draft | active | retired"
    }
    NOTIFICATIONS {
        uuid notification_id PK
        string idempotency_key UK
        uuid user_id FK
        uuid template_version_id FK
        string channel
        string priority "high | medium | low"
        string status
        timestamp created_at
        timestamp scheduled_at
    }
    DELIVERY_ATTEMPTS {
        bigint attempt_id PK
        uuid notification_id FK
        string provider "fcm | apns | twilio | ses"
        string provider_msg_id
        string status "sent | delivered | failed | bounced"
        int attempt_no
        timestamp ts
    }
```

Выбор хранилищ — отдельная мини-задача, и это частый follow-up вопрос:

| Данные | Хранилище | Почему |
|---|---|---|
| User prefs, devices, templates | PostgreSQL / MySQL | Мало записей, читаются часто, важна консистентность и простые join'ы; шардируем по user_id при росте |
| Delivery status / audit log | Cassandra / ScyllaDB | Write-heavy (сотни ГБ в день), читается редко (аудит, расследования); шард по notification_id или user_id, TTL на горячие данные |
| Кэш «популярных» статусов | Redis (LRU) | Горячие уведомления читаются многократно (in-app inbox) |
| Idempotency keys, rate-limit счётчики | Redis | Нужны атомарные INCR/SET NX с TTL |
| Холодный аудит | S3 + Parquet | Дёшево, читается batch-запросами |

Для **in-app inbox** (лента уведомлений в приложении) схема другая: Cassandra-таблица, шардированная по user_id и отсортированная по timestamp — запрос «дай последние 50 уведомлений пользователя» превращается в чтение одной партиции.

---

## Deep dive

### 1. Приоритетные очереди

Базовая идея, которую предлагают практически все сильные разборы: **не одна очередь с полем priority, а несколько физических топиков** — `notify.high`, `notify.medium`, `notify.low`.

```mermaid
flowchart TD
    PR["Prioritizer<br/>определяет класс сообщения"] --> H[("notify.high<br/>OTP, security")]
    PR --> M[("notify.medium<br/>транзакционные")]
    PR --> L[("notify.low<br/>промо")]
    H --> W1["Sender workers<br/>consumer group A (x20)"]
    M --> W2["Sender workers<br/>consumer group B (x10)"]
    L --> W3["Sender workers<br/>consumer group C (x5)"]
    W3 -.->|«воркеры low сначала проверяют,<br/>нет ли сообщений в high»| H
```

Правила, которые стоит озвучить:

- **OTP — всегда high**: если пользователь не получил код, он не залогинится и не завершит транзакцию — прямой убыток. Промо, опоздавшее на полчаса, никто не заметит.
- Консьюмеры **сначала дренируют high, потом medium, потом low** (priority-aware polling), либо каждому классу выделен свой пул воркеров с гарантированной ёмкостью.
- Цель: **лаг в high-топике ≈ 0 всегда**, даже когда в low прилетела рассылка на 50 млн сообщений. Метрика, за которой следим — consumer lag per topic.
- Отдельный инфраструктурный бонус: изоляция отказов. Медленный SMS-провайдер увеличивает лаг только в своём топике, не блокируя email.

Альтернатива — одна очередь + priority queue внутри консьюмера. Почему хуже: head-of-line blocking на уровне партиции Kafka и сложнее масштабировать классы независимо. Зато меньше топиков = проще эксплуатация. Честно назовите оба варианта и объясните выбор.

### 2. Per-user rate limiting и user preferences

Два разных вида rate limiting — их путают, и интервьюер это замечает:

1. **Per-user / per-category**: «не больше 5 промо-уведомлений пользователю в день суммарно со всех бизнес-юнитов». Защищает пользователя от спама (в Amazon-like компании десятки команд шлют уведомления одному и тому же человеку).
2. **Per-client (SaaS)**: «клиент X может слать 100 RPS по своему API-ключу» — квоты, биллинговые тарифы, защита платформы.

Плюс третий, тонкий случай: **провайдерский rate limit** (см. deep dive 4) — FCM/Twilio сами режут трафик, и под них нужен token bucket на отправку.

Реализация per-user лимита:

```text
# Redis, sliding window via sorted set или простой счётчик с TTL
KEY  ratelimit:promo:{userId}:{yyyy-mm-dd}
INCR key; EXPIRE key 86400
если значение > LIMIT → drop или defer (перенести на завтра / отложить до конца quiet hours)
```

- Транзакционные уведомления (OTP, «списано 1290 ₽») **не режутся никогда** — лимит применяется только к промо/маркетинговым категориям. Это важная бизнес-логика, проговорите её.
- Где стоит rate limiter в pipeline — предмет торга с интервьюером: до prioritizer'а (экономим ресурсы) или после user preferences (точнее учитываем категорию). Оба варианта валидны; в разборах прямо говорят «эти два компонента можно менять местами в зависимости от разговора с интервьюером» — умение сказать такое вслух плюсует.
- User preferences (opt-out, quiet hours) и rate limit логически рядом: оба фильтруют по правилу «можно ли ЭТОМУ пользователю СЕЙЧАС слать ТАКОЕ». Часто объединяются в один модуль «Delivery Policy Engine».
- Quiet hours: не дропаем, а переносим `scheduledAt` на конец тихих часов в таймзоне пользователя (кроме high-priority).

### 3. Дедупликация и идемпотентность

Источники дублей, которые нужно перечислить:

- Клиент ретраит HTTP-запрос после таймаута → два одинаковых события в incoming-очереди.
- Kafka даёт at-least-once: консьюмер упал после отправки, но до коммита offset → сообщение обработается повторно.
- Replay топика после сбоя (классический сценарий: email-сервис лежал сутки, проиграли партиции заново — а SMS-сендер всё это время работал и уже всё отправил).
- Провайдер сам может ответить таймаутом, но доставить.

Слоёная защита:

1. **Idempotency key на входе.** Клиент присылает `X-Idempotency-Key` (или платформа генерирует детерминированный ключ `hash(userId + templateId + businessEventId)`). Notification Service делает `SET NX` в Redis с TTL 24–72 ч: ключ уже есть → возвращаем тот же notificationId, не публикуем дубль.
2. **Идемпотентные воркеры.** Каждый сендер перед отправкой проверяет: «этот notificationId по этому каналу уже в статусе sent/delivered?» — если да, пропускаем. Дубль после retry — это **ошибка дедупликации, а не неизбежность**; проектируйте так, чтобы дважды обработанное сообщение отправлялось один раз.
3. **Дедупликация на устройстве.** FCM/APNS могут доставить пуш дважды — клиентский SDK должен дедуплицировать по message id. Про это почти никто не говорит — скажите вы.

Про хранение ключей: если ключей слишком много для памяти, классическая оптимизация из разборов — **Bloom filter** перед проверкой по диску. Отрицательный ответ Bloom-фильтра («точно не видели») бесплатен, положительный — идём проверять в точное хранилище. В идеальном мире горячие ключи просто живут в Redis с TTL, равным окну возможных ретраев.

Отдельно стоит сказать, чего делать **не надо**: двухфазный коммит (2PC) между очередью и базой статусов — «правильное» учебное решение, но на практике неприемлемо медленное (два раунда сетевого взаимодействия на каждое сообщение при десятках тысяч msg/s). Индустрия вместо этого использует idempotency keys + at-least-once + дедупликацию. Если упоминаете согласованность БД↔очередь на входе — правильный паттерн **transactional outbox**.

### 4. Провайдеры, retry и трекинг доставки

Канал → провайдеры:

| Канал | Провайдеры | Особенности |
|---|---|---|
| Push iOS | **APNS** | HTTP/2, device token может протухнуть (`410 Gone` → удаляем токен из devices) |
| Push Android | **FCM** | Бесплатный, но rate-limited; `NotRegistered` → чистим токен |
| SMS | Twilio, Vonage, локальные агрегаторы | Дорого ($0.01–0.05/шт), медленно, жёсткие лимиты провайдера |
| Email | SES, SendGrid, свой SMTP | Bounces, репутация домена, webhook'и о доставке |
| In-app | Свой WebSocket/SSE gateway + inbox в БД | Не зависит от внешних провайдеров вообще |

**Vendor routing.** Глобальная компания интегрирована с несколькими SMS-вендорами (один силён в Азии, другой — в США и Европе). SMS-handler внутри себя решает: какой вендор для этого номера, какой приоритет между вендорами, как распределять трафик (weighted routing), failover на резервного при 5xx. Это красивый deep dive, который почти никто не раскрывает спонтанно.

**Retry-политика:**

```mermaid
stateDiagram-v2
    [*] --> Accepted
    Accepted --> Queued : publish to priority topic
    Queued --> Sending : worker picked up
    Sending --> Sent : provider 2xx
    Sending --> RetryWait : timeout / 5xx / 429
    RetryWait --> Sending : backoff expired (1s, 2s, 4s + jitter)
    RetryWait --> DeadLetter : attempts > max (5)
    Sent --> Delivered : provider webhook / FCM ACK
    Sent --> Failed : webhook bounce / 410 Gone
    Failed --> RetryWait : transient (5xx)
    Failed --> DeadLetter : permanent (bounce, invalid token)
    Delivered --> [*]
    DeadLetter --> [*] : alert + manual reprocess
```

- **Exponential backoff с рандомным jitter**: `delay = base * 2^attempt + random(0, base)`. Без jitter все воркеры ретраят одновременно и добивают и без того задыхающегося провайдера (thundering herd).
- **429 от провайдера** — отдельный случай: это не сбой, а сигнал притормозить → token bucket на исходящий трафик к каждому провайдеру (у FCM и Twilio лимиты публично задокументированы; превышение = бан sender'а).
- **Постоянные ошибки не ретраим**: `410 Gone` / `NotRegistered` (мёртвый device token), hard bounce email, несуществующий номер — сразу в failed + чистим контактные данные.
- **DLQ** — не свалка, а observable компонент: метрики, алерты, инструмент ручного/автоматического reprocess.

**Трекинг доставки.** Каждое изменение статуса пишется в трекинг-стор (Cassandra — write-heavy нагрузка, читается редко). Зачем: аудит и споры («вы не уведомили клиента об изменении тарифа» — юридическое требование во многих доменах), метрики deliverability, дедупликация воркеров. Статусы `delivered`/`opened` приходят webhook'ами от провайдеров (SES, Twilio) и событиями от клиентского SDK (push open tracking).

### 5. Шаблонизация

- Отдельный **Template Service + Template DB**: шаблоны CRUD'ятся через админку, версионируются (`templateId + version`), имеют локали и канал-специфичные тела (шаблон SMS ≠ шаблон email: лимит 160 символов vs HTML-вёрстка).
- Клиент в запросе передаёт `templateId + params`, а не готовый текст — контент централизован, маркетинг правит тексты без релизов.
- Версия шаблона фиксируется в уведомлении: через месяц можно восстановить, **какой именно текст** ушёл пользователю (аудит, споры).
- Рендеринг — на этапе pipeline (после приоритизации, перед публикацией в канальные топики), чтобы в топиках лежал готовый к отправке payload.
- Валидация: обязательные плейсхолдеры, preview-отправка на тестовую группу, A/B-варианты шаблона (если интервьюер спрашивает про эксперименты).

```text
Template: order_confirmed / v3 / ru / push
Title: "Заказ {{orderId}} подтверждён"
Body:  "Сумма {{amount}}. Доставка {{deliveryDate}}."
Required params: [orderId, amount, deliveryDate]
```

---

## Trade-offs

| Решение | Выбрали | Альтернатива | Цена выбора |
|---|---|---|---|
| Sync vs async приём | Async (202 + очередь) | Синхронная отправка | Клиент не знает мгновенно итог; нужен статус-API |
| Kafka vs SQS/RabbitMQ | Kafka | SQS (проще операционно), RabbitMQ | Kafka сложнее в эксплуатации; зато replay, партиционирование, огромный throughput |
| Несколько топиков по приоритетам vs одна очередь с priority | Несколько топиков | Priority queue в консьюмере | Больше топиков = больше операционной сложности |
| Отдельный сервис на каждый шаг pipeline vs монолит | Микросервисы на масштабе | Один deployable сервис на старте | Микросервисы: сеть, observability, сложность деплоя |
| Дедупликация в Redis vs Bloom filter + диск | Redis TTL для горячего окна | Bloom filter при огромных объёмах | Bloom допускает false positives — нужен fallback на точную проверку |
| At-least-once + идемпотентность | Да | «Exactly-once» семантика Kafka | EOS покрывает только внутренность Kafka, не доставку до провайдера и устройства |
| Push через FCM/APNS напрямую vs через агрегатор (OneSignal, Braze) | Напрямую (контроль, дешевле на масштабе) | Агрегатор (быстрый старт) | Своя интеграция = поддержка токенов, ретраев, вебхуков |
| Хранение статусов в Cassandra vs PostgreSQL | Cassandra | Postgres с партициями | Нет ad-hoc join'ов по аудиту — выносим аналитику в холодный слой |

---

## Красные флаги и типичные ошибки

То, что интервьюеры реально отмечают как слабые места кандидатов:

- **Синхронная отправка в request path.** «Принял HTTP-запрос → сходил в Twilio → ответил». Один таймаут провайдера — и сообщение потеряно, плюс latency клиента привязана к худшему провайдеру.
- **Нет очереди между этапами.** Прямые вызовы приоритизатор → сендеры = каскадные блокировки и потеря сообщений при падении сендера.
- **Нет retry-политики вообще** или retry без backoff/jitter (добиваем провайдера синхронными ретраями).
- **Нет дедупликации**: кандидат говорит «Kafka нам даст exactly-once». Нет — EOS работает только внутри Kafka; до провайдера и устройства всё равно at-least-once.
- **Игнорирование rate limits провайдеров**: «шлём в FCM сколько хотим» → реальный бан sender'а. Senior-ответ упоминает token bucket на исходящие вызовы.
- **Все уведомления равны**: промо-рассылка на 10 млн сообщений душит OTP в общей очереди.
- **Забытые device tokens**: не чистим протухшие токены → APNS/FCM понижают репутацию, растёт failed rate.
- **Нет трекинга статусов**: на вопрос «как узнаем, что уведомление доставлено?» — тишина.
- **Рисовать микросервисный ад для 10 тыс. уведомлений в день** — или, наоборот, предлагать один cron-скрипт для 100 млн пользователей. Масштаб должен определять дизайн.
- **2PC для согласованности** — ахиллесова пята «книжных» кандидатов; правильный ответ — outbox + идемпотентность.

---

## Что говорить интервьюеру: опорный план на 45 минут

1. **(5 мин) Уточнения**: каналы, масштаб, типы трафика, SaaS или внутренняя платформа. Зафиксировать: push/email/SMS, 10–500 млн/день, транзакционные + промо.
2. **(5 мин) Требования и оценки**: FR/NFR, посчитать RPS и объём хранения на доске. Проговорить «exactly-once недостижим, строим at-least-once + идемпотентность».
3. **(5 мин) API + приём**: асинхронный `POST /v1/notifications`, idempotency key, 202 Accepted.
4. **(10 мин) High-level**: gateway → validation/preferences → rate limit → prioritizer → топики по приоритетам → канальные сендеры → провайдеры; трекер и DLQ сбоку.
5. **(15 мин) Deep dive по выбору интервьюера**: приоритетные очереди, дедупликация, retry/DLQ, vendor routing, шаблоны, bulk-рассылки.
6. **(5 мин) Trade-offs, метрики, алерты**: consumer lag per topic, delivery rate по каналам, latency p99 для high, DLQ size, provider error rate.

Фразы, которые звучат сильно:

- «Уведомления — это классическая fan-out задача; узнав её, вы переиспользуете тот же паттерн в новостных лентах и мессенджерах».
- «Я бы начал с одного deployable сервиса и выносил компоненты по мере роста нагрузки — но очередь между приёмом и отправкой заложил бы сразу, это дёшево и снимает целый класс отказов».
- «Компоненты X и Y можно поменять местами в pipeline — это зависит от того, что для вас важнее; давайте обсудим».

---

## Что спросят дополнительно

- **Как реализовать bulk-рассылку «всем, кто купил молоко 3 дня назад»?** Отдельный контур: транзакционные события бизнес-сервисов → parser → поисковый стор (Elasticsearch/Mongo) → query engine с DSL-фильтрами → список userId → тот же Notification Service. Бонус: тот же query engine переиспользуется rule engine'ом («отменил 10 заказов подряд → антифрод») — сама рассылка это rule «условие → действие».
- **Scheduled / recurring уведомления?** Таблица `scheduled_at` + сканер (или delay-очереди), который публикует в incoming-топик в нужный момент. Distributed cron с лидер-элекцией.
- **Как масштабировать партиционирование?** Партиции Kafka по user_id (порядок важен для in-app) или по topic/каналу; ZooKeeper/KRaft для координации консьюмеров; fan-out на сендеры через consumer groups.
- **In-app центр уведомлений?** Cassandra по user_id + Redis-кэш горячих лент + WebSocket-gateway; счётчик непрочитанных.
- **Multi-region?** Региональные кластеры у провайдеров (APNS/FCM глобальны, SMS-вендоры локальны), геороутинг, репликация prefs.
- **Как тестировать?** Контрактные тесты с mock-провайдерами, shadow-трафик, chaos (убиваем сендер — проверяем, что ничего не потерялось и не задублилось).
- **Метрики и SLO?** p99 latency OTP < 5 с, delivery rate > 99% для транзакционных, consumer lag, DLQ size, provider error/429 rate, стоимость SMS на пользователя.
- **Безопасность?** PII в шаблонах (минимизируем в push — тело видно на локскрине), шифрование токенов, подпись webhook'ов провайдеров, разграничение доступа к Template Service.

---

## Источники и видео по теме

- [Вопрос для собеседования по проектированию системы уведомлений для обработки миллиардов пользователей](https://www.youtube.com/watch?v=CUwt9_l0DOg)
- [Как разработать систему уведомлений / Что нужно знать для собеседований по системному проектированию](https://www.youtube.com/watch?v=0pOYU5-pXWA)
- [Notification System Design: Handling Millions of Messages](https://www.youtube.com/watch?v=TpZ3dHb3jRE)
- [19: Notification Service / Systems Design Interview Questions With Ex-Google SWE](https://www.youtube.com/watch?v=J-5JozlYIqI)
- [Глубокое погружение в проектирование сервисов уведомлений с Google SWE!](https://www.youtube.com/watch?v=TpugGhXhdaU)
- [System Design 15: Design Scalable Notifications System / SMS / OTP / Email & Push / HLD / LLD](https://www.youtube.com/watch?v=Yv9q8d11Y7k)
