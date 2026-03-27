# ТЗ: Корпоративный Мессенджер Для CRM

## Цель
- Реализовать встроенную чат-систему уровня рабочего корпоративного мессенджера.
- Избежать временных и хрупких решений: сразу проектировать production-ready модуль.
- Обеспечить масштабируемость, отказоустойчивость, безопасность и контроль доступа.

## Границы первого релиза
### Входит
- Личные чаты, групповые чаты, каналы.
- Вложения, реакции, ответы, редактирование, удаление сообщений.
- Поиск по сообщениям.
- Realtime-доставка.
- Уведомления и аудит действий.
- Платформа "прокаченных сообщений" (rich messages).

### Не входит в первый релиз
- Продвинутые групповые видеозвонки (SFU, запись, транскрипция, call center очереди).
- End-to-end шифрование.
- Федерация между инсталляциями.

## Нефункциональные требования
- Источник истины: PostgreSQL.
- Realtime: WebSocket + fallback механизмы.
- Консистентность: Outbox pattern (без потери событий).
- Очереди/фон: Celery + Redis/Rabbit.
- Файлы: S3-совместимое хранилище.
- Наблюдаемость: метрики, structured logs, алерты, трассировка.
- Безопасность: RBAC/ABAC, rate limits, антиспам, аудит.
- Нулевая потеря сообщений (допустимы дубли с идемпотентной обработкой).

## SLO
- P95: отправка до доставки онлайн-клиенту < 400 мс.
- P95: загрузка истории чата (50 сообщений) < 300 мс.
- Доступность chat API: 99.9%.
- RPO для метаданных сообщений: 0.

## Архитектура
- Domain-модель чатов с транзакционной записью.
- Event-driven слой доставки и синхронизации.
- Outbox/dispatcher/retry/dead-letter.
- Версионирование схем событий и payload.
- Идемпотентность на сервере и клиенте.

## Основные сущности данных
- `chat` (direct/group/channel, org_id, visibility, settings)
- `chat_member` (role, mute, permissions, joined_at, last_read_message_id)
- `message` (chat_id, sender_id, seq_no, body, body_type, meta_json, status)
- `message_revision` (история правок)
- `message_reaction`
- `message_attachment` (mime, size, scan_status, storage_key)
- `message_delivery` (delivered_at/read_at)
- `chat_event` (immutable audit/event log)
- `mention`, `link_preview`, `message_action` (rich-слой)

## Прокаченные сообщения (Rich Message System)
- Типизированные payload по `body_type`:
  - `text_markdown`
  - `system_event`
  - `file`
  - `task_card`
  - `crm_record_ref`
  - `poll`
  - `approval_request`
- JSON schema validation на сервере для каждого типа.
- `schema_version` для безопасной эволюции формата.
- Renderer registry на фронте по `body_type`.
- Поддержка:
  - `@mentions` пользователей и сущностей CRM.
  - Reply/thread anchors.
  - Link preview pipeline.
  - Action buttons с проверкой прав на сервере.
  - История редактирования сообщений.

## API и Realtime контракт
- REST API для CRUD, истории, поиска, настроек.
- WebSocket события:
  - `chat.message.created`
  - `chat.message.updated`
  - `chat.message.deleted`
  - `chat.message.reacted`
  - `chat.member.joined`
  - `chat.member.left`
  - `chat.read.cursor.updated`
  - `chat.presence.updated`
- Каждое событие содержит:
  - `event_id`
  - `chat_id`
  - `seq_no`
  - `occurred_at`
  - `schema_version`

## Звонки: архитектурные принципы (Voice/Video)
- Ключевое правило: `P2P по возможности + TURN fallback`, иначе часть звонков не установится.
- Сигналинг: отдельный WebSocket namespace (`call.*`) с идемпотентными событиями.
- Установление медиа: WebRTC (`ICE`, `STUN`, `TURN`, `DTLS-SRTP`).
- NAT/Firewall: при невозможности direct P2P трафик релеится через TURN.
- Для 1:1 базовый режим: приоритет P2P, TURN как резерв.
- Для групповых 4+ участников продвинутый режим: `SFU` (mesh в production не масштабируется).
- Обязательные telemetry метрики: `call_setup_time`, `join_success_rate`, `packet_loss`, `jitter`, `turn_usage_ratio`.
- QoS-политики: адаптивный битрейт, деградация видео до аудио, retry/reinvite при кратковременном обрыве.

## Блоки внедрения звонков
### Базовый блок (обязательный, production-ready)
- 1:1 аудио/видео звонок.
- `P2P-first`, автоматический `TURN fallback`.
- Call states: `ringing`, `connecting`, `connected`, `reconnecting`, `ended`, `failed`.
- Device controls: mic/cam on-off, выбор устройства, mute, hangup.
- Базовая безопасность: авторизация в сигналинге, ограничения доступа к звонку по membership.
- Базовая наблюдаемость и алерты по провалам установления.

### Продвинутый блок (после стабилизации базового)
- Групповые звонки через SFU.
- Screen share, поднятая рука, speaker detection.
- Серверная запись (опционально), транскрипция, post-call summary.
- Политики качества по ролям/каналам, приоритизация трафика.
- Интеграция с расписаниями/календарем и push-reminders.
- Админ-панель качества звонков (QoE dashboard + drill-down).

## Спринты (без MVP-костылей)
### Sprint 0: Foundation & Architecture
- Что делаем: ADR, контракты событий, миграции БД, observability baseline.
- Что визуально видно: отдельный раздел в админке/доках с версией протокола, health/dashboard страницы зеленые.
- Результат спринта: команда работает по одному архитектурному контракту, CI стабилен.

### Sprint 1: Core Chat Domain
- Что делаем: чаты, участники, роли, отправка/получение сообщений, read cursor.
- Что визуально видно: можно создать чат, добавить людей, отправить сообщение, увидеть “прочитано/не прочитано”.
- Результат спринта: стабильный chat-domain без realtime, покрытый тестами.

### Sprint 2: Realtime Transport
- Что делаем: WebSocket gateway, подписки, outbox dispatcher, reconnect/dogon пропущенных событий.
- Что визуально видно: сообщения приходят без перезагрузки страницы; после оффлайна клиент догоняет историю автоматически.
- Результат спринта: надежный realtime без потерь при реконнекте.

### Sprint 3: Attachments & Security
- Что делаем: presigned upload/download, antivirus pipeline, ограничения типов и размеров, quarantine.
- Что визуально видно: можно прикрепить файл к сообщению, виден статус загрузки и статус проверки файла.
- Результат спринта: безопасные вложения, готовые для production.

### Sprint 4: Rich Message Platform
- Что делаем: типы rich-message, schema validation, `text/system/file/crm-ref`, mentions и link preview.
- Что визуально видно: карточки CRM в сообщениях, кликабельные `@mentions`, предпросмотр ссылок.
- Результат спринта: расширяемая платформа прокаченных сообщений с совместимостью по версиям.

### Sprint 5: UX Features
- Что делаем: реакции, reply, edit/delete, история правок, поиск, фильтры, пагинация.
- Что визуально видно: реакции на сообщения, ветка ответа, метка “изменено”, рабочий поиск по чату.
- Результат спринта: UX parity с современным рабочим мессенджером.

### Sprint 6: Notifications & Presence
- Что делаем: presence/typing, mute/snooze, маршрутизация и дедуп уведомлений, антиспам.
- Что визуально видно: индикатор “печатает…”, онлайн-статусы, корректные push/in-app уведомления без дублей.
- Результат спринта: предсказуемая система уведомлений и присутствия.

### Sprint 7: Hardening & Scale
- Что делаем: load/chaos тесты, индексация, backpressure, защита от штормов реконнекта.
- Что визуально видно: стабильная работа при высокой нагрузке, без массовых лагов интерфейса.
- Результат спринта: подтвержденные SLO под целевой нагрузкой.

### Sprint 8: Rollout & Migration
- Что делаем: feature flags, canary rollout, миграции без даунтайма, runbooks.
- Что визуально видно: поэтапное включение функционала по организациям, без падения текущих чатов.
- Результат спринта: безопасный production rollout.

## Спринты по звонкам (полный трек)
### Call Sprint 0: RFC и сетевой baseline
- Что делаем: call-ADR, signaling contract, state machine, STUN/TURN baseline, SLI/SLO.
- Что визуально видно: технический demo-стенд connectivity и отчеты по успешности соединения.
- Результат спринта: готовая инфраструктурная база для звонков.

### Call Sprint 1 (Базовый): Signaling Core
- Что делаем: `call.invite`, `call.accept`, `call.reject`, `call.hangup`, `call.ice_candidate`, идемпотентность.
- Что визуально видно: входящий/исходящий звонок появляется и корректно завершается даже без поднятого медиа.
- Результат спринта: стабильная сигнализация без залипших звонков.

### Call Sprint 2 (Базовый): WebRTC 1:1 + TURN fallback
- Что делаем: SDP offer/answer, ICE checks, `P2P-first + TURN fallback`, диагностика фейлов.
- Что визуально видно: 1:1 звонок проходит между разными сетями; при сложном NAT звонок не падает, а уходит через TURN.
- Результат спринта: рабочие 1:1 voice/video звонки в реальных сетевых условиях.

### Call Sprint 3 (Базовый): UX и устойчивость
- Что делаем: call UI, reconnect/retry flow, управление mic/cam/devices, базовые QoE-алерты.
- Что визуально видно: пользователь может mute/unmute, переключить камеру/микрофон, восстановить звонок после краткого обрыва.
- Результат спринта: production-ready базовый блок звонков.

### Call Sprint 4 (Продвинутый): Group Calling через SFU
- Что делаем: SFU интеграция, публикация/подписка потоков, политики для больших комнат.
- Что визуально видно: групповой звонок 4+ участников без “умирания” качества как в mesh.
- Результат спринта: масштабируемый продвинутый backbone групповых звонков.

### Call Sprint 5 (Продвинутый): Совместная работа в звонке
- Что делаем: screen share, hand raise, active speaker, moderation, роли и права в звонке.
- Что визуально видно: демонстрация экрана, поднятая рука, подсветка активного спикера, модераторские действия.
- Результат спринта: полноценный командный сценарий для рабочих созвонов.

### Call Sprint 6 (Продвинутый): Post-call intelligence
- Что делаем: запись по политикам, транскрипция, summary в чат, индексация артефактов.
- Что визуально видно: после звонка в чате появляется summary, ссылка на запись/транскрипт, это находится через поиск.
- Результат спринта: завершенный продвинутый call stack с post-call ценностью.

### Call Sprint 7: Hardening и rollout
- Что делаем: нагрузка, chaos, тесты на NAT matrix, canary rollout, runbooks.
- Что визуально видно: постепенное включение звонков по организациям, без массовых инцидентов.
- Результат спринта: безопасный production rollout звонков.

## Инженерная декомпозиция спринтов (для разработки)
Формат: конкретные задачи по ролям + демонстрируемый инкремент в конце спринта.

### Chat Track (Sprint 0-8)
| Спринт | Backend (обязательно) | Frontend (обязательно) | DevOps/Platform | QA | Что показываем на демо | Инкремент |
|---|---|---|---|---|---|---|
| Sprint 0 | Утвердить `chat_event` схему, подготовить миграции `chat/chat_member/message`, завести OpenAPI-заглушки | Каркас Chat UI (layout, роуты, state shell), контрактный слой API client | Поднять окружение CI для chat-сервисов, базовые метрики и логи | Контрактные тест-кейсы по API/events, smoke pipeline | Пустой чат-модуль с живым health и CI | Готова техническая база без feature debt |
| Sprint 1 | Реализовать CRUD чатов, membership, `seq_no`, `read_cursor` в БД и API | Экран списка чатов, экран диалога, отправка/получение через REST | Миграции в staging, профили окружений | API-тесты на доступы и роли, e2e на создание чата | Создание чата и обмен сообщениями в одном окне | Рабочий core без realtime |
| Sprint 2 | WebSocket gateway, подписки, outbox dispatcher, replay пропущенных событий | WebSocket клиент, reconnect, optimistic update + reconcile по `seq_no` | Мониторинг очередей/retry/DLQ, алерты lag | Негативные тесты разрыва сети, тесты дублирования событий | Сообщение прилетает онлайн без refresh, после reconnection догон истории | Надежный realtime слой |
| Sprint 3 | Presigned upload/download, `message_attachment`, antivirus workflow, quarantine | UI загрузки файла, прогресс-бар, состояния scan/quarantine/fail | Интеграция S3 и antivirus workers, лимиты размера/типа | Тесты загрузки больших/вредоносных файлов | Отправка файла в чат с финальным статусом | Production-safe вложения |
| Sprint 4 | `body_type` schemas, validation, renderer contract, mentions/link-preview workers | Рендер `text/system/file/crm-ref`, UI mentions, preview ссылок | Кэш/очередь для preview worker | Контрактные тесты для schema_version, regression rich сообщений | Сообщение с CRM-карточкой и `@mention` | Rich message platform |
| Sprint 5 | API реакций/reply/edit/delete + `message_revision`, поиск/фильтры | Реакции, reply thread anchor, edit-history modal, поиск по чату | Оптимизация индексов поиска, профилирование slow queries | E2E сценарии редактирования/поиска/реакций | Полноценный UX как в рабочем мессенджере | Feature-complete chat UX |
| Sprint 6 | Presence/typing events, mute/snooze rules, dedup уведомлений | Индикаторы online/typing, настройки уведомлений на чат | Каналы доставки push/in-app/email, rate-limit антиспам | Тесты “без дублей”, нагрузка на presence | Корректные уведомления и статусы присутствия | Стабильная система уведомлений |
| Sprint 7 | Backpressure механизмы, оптимизация hot paths, отказоустойчивость Redis/Rabbit | Визуально устойчивый UI при burst-событиях, graceful деградация | Load+chaos стенды, алерты SLO | Performance regression suite, soak tests | Чат стабилен под высокой нагрузкой | Система выдерживает целевой трафик |
| Sprint 8 | Feature flags на org-level, миграции/бекфилл без даунтайма, runbooks | UI-переключатели rollout-статуса (внутренние), fallback UX | Canary rollout пайплайн, rollback playbook | UAT и release acceptance | Включение по организациям без инцидентов | Безопасный production rollout |

### Calls Track (Call Sprint 0-7)
| Спринт | Backend (обязательно) | Frontend (обязательно) | DevOps/Platform | QA | Что показываем на демо | Инкремент |
|---|---|---|---|---|---|---|
| Call Sprint 0 | ADR call state-machine, signaling contract (`call.*`) | Подготовка call state store и UI shell для звонка | Поднять STUN/TURN, auth к TURN, базовые QoE-метрики | Connectivity matrix тест-план | Тех-стенд: успешность ICE/TURN по разным сетям | Готов baseline для звонков |
| Call Sprint 1 | Реализовать signaling endpoints/events: invite/accept/reject/hangup/ice | Экран входящего/исходящего, статусы `ringing/ended/failed` | Мониторинг signaling channel и таймаутов | Тесты на идемпотентность событий и race conditions | Вызов проходит по сигналингу end-to-end | Устойчивый signaling core |
| Call Sprint 2 | WebRTC handshake (SDP/ICE), `P2P-first + TURN fallback`, error mapping | WebRTC peer lifecycle, обработка ICE states, UI причин фейла | TURN лимиты, relay метрики, алерты setup failure | Тесты NAT/firewall сценариев | 1:1 звонок работает даже в сложной сети через TURN | Рабочий базовый media layer |
| Call Sprint 3 | Reinvite/reconnect flow, device capability API, call QoE events | Управление mic/cam/devices, reconnect UX, fallback audio-only | Дашборд `join_success_rate/packet_loss/jitter` | Endurance тесты длительных звонков | Реальный 1:1 voice/video без “залипаний” | Базовый блок звонков production-ready |
| Call Sprint 4 | Интеграция SFU, роутинг публикаций/подписок, room policy | Grid UI участников, управление подписками потоков | Развертывание SFU, autoscaling policy | Нагрузка групповых звонков (4-20+) | Групповой звонок без деградации mesh | Продвинутый backbone групповых звонков |
| Call Sprint 5 | Модерация: роли, разрешения, server-side контроль действий | Screen share, hand raise, active speaker, moderator controls | Метрики share quality и событие модерации | E2E командных сценариев созвона | Совместная работа в звонке | Командный call workflow |
| Call Sprint 6 | Запись, транскрипция, summary pipeline, хранение артефактов | UI записи/транскрипта/summary в чате и поиске | Storage lifecycle policy, compliance retention | Тесты приватности и удаления по политике | После звонка есть summary и материалы в чате | Post-call intelligence |
| Call Sprint 7 | Hardening, rollout guards, feature flags, rollback hooks | UI graceful fallback при частичных сбоях | Chaos для TURN/SFU, canary rollout | Release regression и rollback drills | Поэтапный запуск без массовых инцидентов | Production rollout звонков |

## Чек-лист готовности по каждому спринту
Отмечать только после демо и прохождения обязательных тестов.

### Chat Sprint 0
- [ ] Архитектурные ADR утверждены и опубликованы.
- [ ] БД-миграции на `chat/chat_member/message` применяются на staging.
- [ ] OpenAPI/событийные контракты зафиксированы в репозитории.
- [ ] CI pipeline зеленый для chat-модуля.
- [ ] Базовые метрики/логи доступны в мониторинге.

### Chat Sprint 1
- [ ] Работает CRUD чатов и управление участниками.
- [ ] Отправка/чтение сообщений через API работает стабильно.
- [ ] `seq_no` и `read_cursor` корректно пишутся в БД.
- [ ] Проверены права доступа (org/chat/member roles).
- [ ] E2E сценарий “создать чат и обменяться сообщениями” проходит.

### Chat Sprint 2
- [ ] WebSocket подписки и доставка событий работают без refresh.
- [ ] Outbox + replay пропущенных событий реализованы.
- [ ] После reconnection клиент восстанавливает состояние чата.
- [ ] Нет потери сообщений при кратком обрыве сети.
- [ ] Алерты на lag/retry/DLQ настроены.

### Chat Sprint 3
- [ ] Upload/download вложений работает через presigned URLs.
- [ ] Антивирусная проверка и quarantine включены.
- [ ] Ограничения по типам/размеру файла применяются.
- [ ] UI показывает статус загрузки и статус проверки.
- [ ] Негативные тесты вредоносных/битых файлов проходят.

### Chat Sprint 4
- [ ] Валидация `body_type` по JSON schema работает на сервере.
- [ ] Реализованы типы `text/system/file/crm-ref`.
- [ ] `@mentions` и link preview работают end-to-end.
- [ ] Версионирование payload (`schema_version`) задокументировано.
- [ ] Регрессионные тесты rich сообщений проходят.

### Chat Sprint 5
- [ ] Работают реакции, reply, edit/delete, история правок.
- [ ] Поиск и фильтры по сообщениям работают в UI.
- [ ] Пагинация истории не ломает порядок сообщений.
- [ ] Контроль прав на редактирование/удаление соблюдается.
- [ ] E2E набор UX сценариев проходит.

### Chat Sprint 6
- [ ] Presence и typing индикаторы работают стабильно.
- [ ] Настройки mute/snooze применяются корректно.
- [ ] Уведомления не дублируются между каналами доставки.
- [ ] Anti-spam/rate-limit правила применяются.
- [ ] Инцидентов по “шумным” уведомлениям нет на staging.

### Chat Sprint 7
- [ ] Пройдены нагрузочные тесты на целевую нагрузку.
- [ ] Пройдены chaos сценарии с деградацией инфраструктуры.
- [ ] Включены backpressure механизмы.
- [ ] P95 метрики укладываются в SLO.
- [ ] Нет критичных perf деградаций по сравнению с Sprint 6.

### Chat Sprint 8
- [ ] Feature flags для организаций работают.
- [ ] Canary rollout и rollback сценарии отработаны.
- [ ] Миграции/бекфилл проходят без даунтайма.
- [ ] Runbook для on-call команды готов.
- [ ] UAT пройден, релиз согласован.

### Call Sprint 0
- [ ] Утвержден call-ADR (state machine + signaling contract).
- [ ] STUN/TURN поднят и доступен из test сред.
- [ ] TURN auth и ротация секретов настроены.
- [ ] QoE метрики собираются в мониторинге.
- [ ] Connectivity matrix базово пройдена.

### Call Sprint 1
- [ ] Реализованы события invite/accept/reject/hangup/ice.
- [ ] Обработана идемпотентность и race conditions.
- [ ] Таймауты и cleanup “зависших” звонков работают.
- [ ] UI корректно отображает статусы звонка.
- [ ] E2E сигналинга проходит без медиа.

### Call Sprint 2
- [ ] Работает WebRTC handshake (SDP/ICE).
- [ ] Реализован принцип `P2P-first + TURN fallback`.
- [ ] Есть диагностика причин ошибки соединения.
- [ ] 1:1 звонок устанавливается в сложных NAT/firewall сетях.
- [ ] Метрики setup success/failure собираются.

### Call Sprint 3
- [ ] Работают reconnect/reinvite и recovery после обрыва.
- [ ] Доступно управление mic/cam и выбор устройств.
- [ ] Доступен fallback в audio-only при деградации.
- [ ] QoE алерты (`packet_loss/jitter`) активны.
- [ ] Базовый 1:1 звонок стабилен на staging.

### Call Sprint 4
- [ ] SFU интеграция завершена и стабильна.
- [ ] Групповой звонок 4+ участников работает без mesh-деградации.
- [ ] Политики комнат и лимиты применяются.
- [ ] Метрики SFU нагрузки и качества видны.
- [ ] Нагрузочные тесты группового звонка проходят.

### Call Sprint 5
- [ ] Работают screen share, hand raise, active speaker.
- [ ] Модерация и права ролей в звонке соблюдаются.
- [ ] UX при сетевых деградациях остается управляемым.
- [ ] Логи модераторских действий сохраняются.
- [ ] E2E сценарий командного звонка проходит.

### Call Sprint 6
- [ ] Работают запись, транскрипция и summary pipeline.
- [ ] Материалы звонка отображаются и ищутся в чате.
- [ ] Политики хранения/удаления соблюдаются.
- [ ] Проверены privacy/compliance требования.
- [ ] Нет критичных сбоев post-call обработки.

### Call Sprint 7
- [ ] Пройдены chaos тесты TURN/SFU деградаций.
- [ ] Feature flags и canary rollout работают корректно.
- [ ] Rollback выполняется без потери сервиса.
- [ ] Runbook и on-call инструкции утверждены.
- [ ] Release regression suite полностью пройден.

## Definition of Done (каждый спринт)
- Критичный функционал покрыт тестами.
- Контракты API/events задокументированы и зафиксированы.
- Наблюдаемость и алерты добавлены.
- Security/perf smoke пройдены.
- Нет временных "затычек" и долгого техдолга.

## Ресурсы команды (рекомендуемо)
- Backend x2
- Frontend x2
- QA x1
- DevOps x1
- Tech Lead x1 (part-time)

## Что реально видно после каждого блока
- После chat Sprint 2: “живой” чат без перезагрузок.
- После chat Sprint 5: полноценный UX мессенджера (реакции, ответы, поиск, редактирование).
- После call Sprint 3: рабочие 1:1 звонки с `P2P-first + TURN fallback`.
- После call Sprint 5: рабочие групповые звонки с совместной работой.
- После call Sprint 7: production rollout с контролируемым риском.
