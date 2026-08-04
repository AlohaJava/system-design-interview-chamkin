# System Design собеседование: как пройти, паттерны и разборы задач

![System Design](https://img.shields.io/badge/System%20Design-Interview-blue)
![Разделов](https://img.shields.io/badge/%D1%80%D0%B0%D0%B7%D0%B4%D0%B5%D0%BB%D0%BE%D0%B2-34-orange)
![Mermaid](https://img.shields.io/badge/mermaid-%D1%81%D1%85%D0%B5%D0%BC%D1%8B%20%D0%B2%20%D0%BA%D0%B0%D0%B6%D0%B4%D0%BE%D0%BC%20%D1%80%D0%B0%D0%B7%D0%B4%D0%B5%D0%BB%D0%B5-brightgreen)
![Язык](https://img.shields.io/badge/%D1%8F%D0%B7%D1%8B%D0%BA-%D1%80%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

**Ключевые слова:** system design собеседование на русском, system design interview, как пройти system design, мок собеседование системный дизайн, разбор задач system design, шардирование, кэширование, kafka, rate limiter, url shortener, дизайн твиттера, дизайн чата, back of the envelope, faang собеседование, бигтех собеседование подготовка

Привет! Это база знаний для подготовки к System Design собеседованиям — от Middle до Staff. Она построена на разборе **500+ транскриптов** реальных мок-собеседований, разборов и лекций (русскоязычных и англоязычных): моки от Team Lead'ов Яндекса, Ozon, Avito, разборы от ex-Meta/ex-Google Staff-инженеров, классические задачи и ловушки. Из этого массива я выкинул воду и собрал практическую систему: как вести интервью шаг за шагом, какие паттерны знать, как разбирать типовые задачи и где кандидаты реально теряют баллы.

Каждый раздел — с mermaid-схемами (GitHub рендерит их прямо в markdown), таблицами trade-off'ов, готовыми формулировками «что сказать интервьюеру» и списком красных флагов.

Меня зовут **Сергей Чамкин**, я и собрал этот репозиторий. Провожу мок-собеседования по Java и System Design: прогоняю как настоящий интервьюер, разбираю ответы и помогаю закрыть пробелы перед реальным собеседованием. Пишите в Telegram — **[@chamkin_s](https://t.me/chamkin_s)**.

Смотрите также смежный репозиторий: [java-interview-questions-chamkin](https://github.com/AlohaJava/java-interview-questions-chamkin) — 300+ вопросов и ответов по Java, Spring, JVM, Kafka и БД.

## Как пользоваться

- **Ни разу не проходили SD-интервью** → начните с раздела «Как проходить»: фреймворк, уточняющие вопросы, расчёты, коммуникация.
- **Знаете теорию, но не проходите** → читайте «Разборы моков»: там конкретные моменты, где кандидаты теряют баллы, и топ-20 ошибок.
- **Готовитесь к конкретной задаче** → берите нужный кейс из «Разборов задач» и проговаривайте вслух по структуре: требования → оценки → API → high-level → deep dive.
- **За день до интервью** → шпаргалки: числа, таблицы trade-off'ов, чек-лист с поминутным планом.
- Внутри разделов материал идёт от самого частого к более редкому: если времени мало, читайте сверху вниз.
- Не зубрите схемы — проговаривайте ход рассуждения вслух. На собеседовании оценивают процесс, а не картинку.

## Разделы

### 00. Как проходить System Design интервью

| Файл | Тема |
| :--- | :--- |
| [00-how-to-pass/interview-framework.md](00-how-to-pass/interview-framework.md) | Пошаговый фреймворк: 7 шагов от требований до wrap-up, тайминг 45–60 минут |
| [00-how-to-pass/clarifying-questions.md](00-how-to-pass/clarifying-questions.md) | Уточняющие вопросы и сбор требований: functional vs non-functional, чек-лист, примеры диалогов |
| [00-how-to-pass/estimation.md](00-how-to-pass/estimation.md) | Back-of-envelope расчёты: QPS, storage, bandwidth, сквозные примеры |
| [00-how-to-pass/communication.md](00-how-to-pass/communication.md) | Коммуникация с интервьюером, типичные ошибки, отличие senior-подхода |

### 01. Строительные блоки и паттерны

| Файл | Тема |
| :--- | :--- |
| [01-building-blocks/caching.md](01-building-blocks/caching.md) | Кэширование: уровни, cache-aside/write-through, инвалидация, hot keys, thundering herd |
| [01-building-blocks/load-balancing.md](01-building-blocks/load-balancing.md) | Балансировка: L4 vs L7, алгоритмы, health checks, sticky sessions, LB как SPOF |
| [01-building-blocks/databases.md](01-building-blocks/databases.md) | Базы данных: SQL vs NoSQL, индексы B-tree/LSM, репликация, read replicas |
| [01-building-blocks/sharding.md](01-building-blocks/sharding.md) | Шардирование: ключи, consistent hashing, resharding, celebrity problem |
| [01-building-blocks/message-queues.md](01-building-blocks/message-queues.md) | Очереди: Kafka vs RabbitMQ vs SQS, семантики доставки, backpressure, DLQ |
| [01-building-blocks/cap-and-consistency.md](01-building-blocks/cap-and-consistency.md) | CAP, PACELC, модели консистентности, кворумы — простым языком |
| [01-building-blocks/cdn-and-blob-storage.md](01-building-blocks/cdn-and-blob-storage.md) | CDN и хранение файлов: push/pull, S3, multipart upload, presigned URLs |
| [01-building-blocks/rate-limiting.md](01-building-blocks/rate-limiting.md) | Rate limiting: token bucket, sliding window, Redis + Lua, 429, circuit breaker |
| [01-building-blocks/api-design.md](01-building-blocks/api-design.md) | Дизайн API: REST vs gRPC vs GraphQL, идемпотентность, пагинация, WebSocket |
| [01-building-blocks/distributed-transactions.md](01-building-blocks/distributed-transactions.md) | Распределённые транзакции: dual write, outbox, saga, 2PC, миф exactly-once |

### 02. Разборы задач

Каждый разбор построен как реальное интервью: требования → оценки нагрузки → API → high-level design → модель данных → deep dive по узким местам → trade-offs → красные флаги.

| Файл | Задача |
| :--- | :--- |
| [02-case-studies/url-shortener.md](02-case-studies/url-shortener.md) | URL Shortener (TinyURL / bit.ly) — «Hello World» системного дизайна |
| [02-case-studies/twitter-feed.md](02-case-studies/twitter-feed.md) | Лента новостей Twitter/X: fanout on write vs read, celebrity problem |
| [02-case-studies/chat-messenger.md](02-case-studies/chat-messenger.md) | Мессенджер (WhatsApp / Telegram): WebSocket-шлюзы, доставка, presence |
| [02-case-studies/video-streaming.md](02-case-studies/video-streaming.md) | Видеоплатформа (YouTube / Netflix): транскодинг, HLS/DASH, CDN |
| [02-case-studies/ride-sharing.md](02-case-studies/ride-sharing.md) | Такси-сервис (Uber): геопоиск, matching, surge pricing |
| [02-case-studies/notification-system.md](02-case-studies/notification-system.md) | Система уведомлений: push/email/SMS, приоритеты, дедупликация |
| [02-case-studies/ticket-booking.md](02-case-studies/ticket-booking.md) | Бронирование билетов: hold с TTL, защита от oversell, waiting room |
| [02-case-studies/web-crawler.md](02-case-studies/web-crawler.md) | Веб-краулер: frontier, politeness, дедупликация, индексация |
| [02-case-studies/file-storage.md](02-case-studies/file-storage.md) | Облачное хранилище (Dropbox): chunking, дедупликация, delta sync |
| [02-case-studies/payment-system.md](02-case-studies/payment-system.md) | Платёжная система: идемпотентность, double-entry ledger, reconciliation |
| [02-case-studies/search-autocomplete.md](02-case-studies/search-autocomplete.md) | Поисковые подсказки: trie, офлайн-пересчёт топов, latency <100мс |
| [02-case-studies/leaderboard.md](02-case-studies/leaderboard.md) | Игровой лидерборд: Redis ZSET, шардирование, топ-K |
| [02-case-studies/ci-cd-system.md](02-case-studies/ci-cd-system.md) | CI/CD система (свой GitHub Actions): оркестрация, раннеры, артефакты |
| [02-case-studies/monitoring-system.md](02-case-studies/monitoring-system.md) | Мониторинг и метрики (свой Prometheus): TSDB, downsampling, алертинг |
| [02-case-studies/hotel-booking.md](02-case-studies/hotel-booking.md) | Бронирование отелей (Booking.com): инвентарь по датам, двойное бронирование |
| [02-case-studies/ad-click-aggregation.md](02-case-studies/ad-click-aggregation.md) | Агрегация рекламных кликов: Kafka + Flink, exactly-once, watermarks |

### 03. Разборы реальных мок-собеседований

| Файл | Тема |
| :--- | :--- |
| [03-mock-breakdowns/mock-analysis.md](03-mock-breakdowns/mock-analysis.md) | 15 разобранных записей моков: где кандидаты теряли баллы, топ-20 ошибок, что ценят интервьюеры |

### 04. Шпаргалки

| Файл | Тема |
| :--- | :--- |
| [04-cheatsheets/numbers.md](04-cheatsheets/numbers.md) | Числа, которые нужно знать наизусть: latency, throughput, порядки QPS/DAU |
| [04-cheatsheets/tradeoffs.md](04-cheatsheets/tradeoffs.md) | Большие таблицы trade-off'ов: какую технологию выбрать и как это обосновать |
| [04-cheatsheets/interview-checklist.md](04-cheatsheets/interview-checklist.md) | Чек-лист подготовки и поминутный план на день собеседования |

## Как это собрано

Материал синтезирован из транскриптов 500+ YouTube-видео: мок-собеседования (Яндекс, Ozon, Avito, ex-Meta/ex-Google Staff), разборы ошибок, лекции по кэшированию, шардированию, очередям и базам данных. В конце каждого раздела — список видео-источников, которые реально использовались при его написании.

## Лицензия

MIT — см. [LICENSE](LICENSE).
