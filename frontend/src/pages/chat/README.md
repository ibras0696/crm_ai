# Chat Module Structure

Дата: 25 мая 2026

## Основной принцип
`ChatPage.tsx` — orchestration слой.
Логика transport/composer вынесена в hooks.
UI разделен на независимые подкомпоненты.

## Структура

- `ChatPage.tsx`
  - связывает state и hooks
  - собирает props для модалок и карточки диалогов

- `hooks/`
  - `useChatConnection.ts` — websocket, typing, presence
  - `useChatMessages.ts` — загрузка истории, scroll pagination, delete/copy
  - `useChatComposer.ts` — отправка, вложения, голосовые
  - `chatComposerUpload.ts` — upload flow для вложений
  - `useAttachmentDownloadUrl.ts` — TTL-кэш `download-url` + refresh-buffer

- `components/messages/`
  - `MessageViewport.tsx` — виртуализованный рендер ленты сообщений
  - `AttachmentPreview.tsx` — lazy-preview вложений только для видимых сообщений

- `components/composer/`
  - `ChatComposerSection.tsx` — нижняя панель ввода
  - `MediaPreviewOverlay.tsx` — полноэкранный preview media

## Правило роста
Если файл приближается к ~600 строкам:
- выделять новую domain-функцию или sub-component,
- не добавлять side-effects в page-компонент.

## E2E Сценарии (Sprint 2)

### Reconnect + Backfill
1. Открыть чат A с сообщениями.
2. Отключить сеть/прервать WS.
3. Отправить 3-5 сообщений в чат A другим пользователем.
4. Восстановить сеть.
5. Проверить, что клиент через `after_seq_no` догрузил пропущенные сообщения без дублей.

### Long Scroll + History
1. Открыть чат с длинной историей.
2. Подгружать старые сообщения скроллом вверх (`before_seq_no`) 5-10 страниц.
3. Проверить отсутствие скачков позиции скролла.
4. Убедиться, что при приходе новых сообщений счетчик растет только если пользователь не у нижней границы.

## E2E Сценарии (Sprint 3)

### Virtualized Long Chat
1. Открыть чат с историей 1000+ сообщений.
2. Проскроллить вверх/вниз 10-15 экранов.
3. Проверить, что FPS стабилен и нет массовых re-render всей ленты.

### Attachment URL Lazy Loading
1. Открыть длинный чат с большим количеством вложений.
2. В Network проверить, что `download-url` запрашивается только при попадании сообщений во viewport.
3. Для уже открытых сообщений прокрутить туда-обратно и убедиться, что повторные запросы ограничены TTL-кэшем.

## Sprint 4 (Prod Readiness)

- Backend endpoint `GET /api/v1/chat/client-config` отдает rollout-конфиг для клиента.
- Backend endpoint `POST /api/v1/chat/telemetry` принимает telemetry события:
  - `ws_reconnect`
  - `message_lag`
  - `attachment_fetch`
- Frontend учитывает rollout/telemetry конфиг в realtime hooks.
- Runbook и alert-rules:
  - `docs/operations/chat_production_rollout.md`
  - `docs/operations/chat_alert_rules.yml`
