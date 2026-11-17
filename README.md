# System Design собеседование: как пройти, паттерны и разборы задач

![System Design](https://img.shields.io/badge/System%20Design-Interview-blue)
![Вопросов и задач](https://img.shields.io/badge/вопросов_и_задач-173-orange)
![Разборов систем](https://img.shields.io/badge/разборов_систем-18-brightgreen)
![Язык](https://img.shields.io/badge/язык-русский-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

Пособие для подготовки к System Design интервью: как уточнить задачу, оценить нагрузку, выбрать архитектуру и объяснить её поведение при сбоях. Банк вопросов и практикум помогут закрепить материал. Общее число вопросов и упражнений с ответами — **173**. Отдельный раздел посвящён проектированию **18 систем**.

Меня зовут **Сергей Чамкин**. Провожу мок-собеседования по Java и System Design: разбираем ход мысли, решения и пробелы перед реальным интервью. Telegram — **[@jaba_javi](https://t.me/jaba_javi)**.

Для языка и backend-разработки есть отдельное пособие: [Java, JVM, Spring, SQL, Kafka и практические задачи](https://github.com/AlohaJava/java-interview-questions-chamkin).

## Как пользоваться

1. **Научитесь ставить задачу.** [Фреймворк интервью](00-how-to-pass/interview-framework.md) → [уточняющие вопросы](00-how-to-pass/clarifying-questions.md) → [оценки нагрузки](00-how-to-pass/estimation.md). Запишите требования и инварианты до выбора технологий.
2. **Проверьте основы.** Начните с [банка вопросов](05-question-bank/fundamentals.md), затем переходите к данным и надёжности. Отвечайте вслух до чтения разбора; за подробностями возвращайтесь к статьям о строительных блоках.
3. **Спроектируйте систему.** Начните с [коротких ссылок](02-case-studies/url-shortener.md), затем переходите к очередям, ленте, файлам и задачам с жёсткими инвариантами: билетам и платежам.
4. **Поменяйте условия.** Решите [вопросы на подумать](06-thinking-practice/scenarios.md): потерянный ответ, сетевое разделение, горячий ключ, рост очереди, восстановление из копии. Разборы скрыты, чтобы можно было сначала решить самостоятельно.
5. **Проведите пробное интервью.** Возьмите незнакомый кейс, ограничьте время и используйте [чек-лист](04-cheatsheets/interview-checklist.md). Затем сравните свою аргументацию с [разборами моков](03-mock-breakdowns/mock-analysis.md).

Числа в примерах — допущения для расчёта. Проверяйте единицы, пиковую нагрузку, долю чтений/записей, репликацию и запас на отказ. Таблица возможностей продукта не заменяет проверку версии, конфигурации и конкретной гарантии.

Попробуйте упражнение по [фрагменту о проектировании сервиса такси с 19:19](https://www.youtube.com/watch?v=popkBBjbAv8&t=1159s). До просмотра выберите один сценарий пассажира и один сценарий водителя. Какие подтверждения нужны каждому, если два водителя почти одновременно принимают заказ? Свой ответ можно сравнить с [разбором сервиса поездок](02-case-studies/ride-sharing.md).

## Разделы

### 00. Как проходить System Design интервью

| Материал |
| --- |
| [Пошаговый фреймворк прохождения System Design интервью](00-how-to-pass/interview-framework.md) |
| [Уточняющие вопросы и сбор требований](00-how-to-pass/clarifying-questions.md) |
| [Back-of-envelope расчёты на собеседовании](00-how-to-pass/estimation.md) |
| [Коммуникация с интервьюером и типичные ошибки](00-how-to-pass/communication.md) |

### Банк вопросов с ответами

Короткий путь к пониманию: каждый ответ объясняет механизм, пример и границы применимости.

| Материал | Вопросов |
| --- | ---: |
| [Основы: требования, расчёты, API и кэш](05-question-bank/fundamentals.md) | 32 |
| [Данные, согласованность и доставка сообщений](05-question-bank/data-and-messaging.md) | 38 |
| [Надёжность, перегрузка и эксплуатация](05-question-bank/reliability-and-operations.md) | 30 |
| [Безопасность и эволюция систем](05-question-bank/security-and-evolution.md) | 31 |

### 01. Строительные блоки и паттерны

| Материал |
| --- |
| [Дизайн API на System Design интервью](01-building-blocks/api-design.md) |
| [Балансировка нагрузки (Load Balancing)](01-building-blocks/load-balancing.md) |
| [Кэширование](01-building-blocks/caching.md) |
| [Базы данных на System Design интервью](01-building-blocks/databases.md) |
| [CAP, PACELC и модели консистентности](01-building-blocks/cap-and-consistency.md) |
| [Шардирование и партиционирование](01-building-blocks/sharding.md) |
| [Очереди сообщений и асинхронность](01-building-blocks/message-queues.md) |
| [Распределённые транзакции и надёжность данных](01-building-blocks/distributed-transactions.md) |
| [Rate Limiting и защита от перегрузки](01-building-blocks/rate-limiting.md) |
| [CDN и хранение файлов (Blob Storage)](01-building-blocks/cdn-and-blob-storage.md) |
| [Надёжность и эксплуатация распределённой системы](01-building-blocks/reliability-and-operations.md) |
| [Безопасность и эволюция распределённой системы](01-building-blocks/security-and-evolution.md) |

### 02. Разборы задач

Требования → оценки → API и данные → архитектура → сбои → альтернативы. Читайте разбор после собственной попытки.

| Материал |
| --- |
| [URL Shortener (TinyURL / bit.ly)](02-case-studies/url-shortener.md) |
| [система уведомлений (Notification System)](02-case-studies/notification-system.md) |
| [лента новостей Twitter/X](02-case-studies/twitter-feed.md) |
| [мессенджер (WhatsApp / Telegram)](02-case-studies/chat-messenger.md) |
| [облачное хранилище (Dropbox / Google Drive)](02-case-studies/file-storage.md) |
| [видеоплатформа (YouTube / Netflix)](02-case-studies/video-streaming.md) |
| [поисковые подсказки (autocomplete / typeahead)](02-case-studies/search-autocomplete.md) |
| [поисковый веб-краулер](02-case-studies/web-crawler.md) |
| [игровой лидерборд](02-case-studies/leaderboard.md) |
| [такси-сервис (Uber / Яндекс Go)](02-case-studies/ride-sharing.md) |
| [бронирование билетов (Ticketmaster / кинотеатр)](02-case-studies/ticket-booking.md) |
| [бронирование отелей (Booking.com)](02-case-studies/hotel-booking.md) |
| [платёжная система](02-case-studies/payment-system.md) |
| [распределённый планировщик заданий](02-case-studies/job-scheduler.md) |
| [сервис feature flags](02-case-studies/feature-flags.md) |
| [система мониторинга и метрик (свой Prometheus / Datadog)](02-case-studies/monitoring-system.md) |
| [проектирование CI/CD системы (свой GitHub Actions)](02-case-studies/ci-cd-system.md) |
| [агрегация рекламных кликов](02-case-studies/ad-click-aggregation.md) |

### Вопросы на подумать

Сначала сформулируйте инвариант и пройдите сценарий по шагам. Затем раскройте разбор.

| Материал | Вопросов |
| --- | ---: |
| [Сценарии отказов, расчёты и архитектурные компромиссы](06-thinking-practice/scenarios.md) | 28 |
| [Ревью архитектур: слабые места и исправленные решения](06-thinking-practice/architecture-review.md) | 14 |

### 03. Разборы реальных мок-собеседований

| Материал |
| --- |
| [Разборы реальных мок-собеседований: чему учат записи](03-mock-breakdowns/mock-analysis.md) |

### 04. Шпаргалки

| Материал |
| --- |
| [Чек-лист подготовки и план на день собеседования](04-cheatsheets/interview-checklist.md) |
| [Числа, которые нужно знать наизусть](04-cheatsheets/numbers.md) |
| [Большие таблицы trade-off'ов: что выбрать и как это обосновать](04-cheatsheets/tradeoffs.md) |

<a id="как-это-собрано"></a>

## Как улучшить материал

Нашли ошибку или полезный пробел — откройте issue или pull request. [Руководство для участников](CONTRIBUTING.md) описывает формат ответа и проверку оформления.

## Лицензия

MIT — см. [LICENSE](LICENSE).
