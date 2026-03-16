# Integration Contracts

Этот документ фиксирует публичные стыки между модулями, чтобы изменение одного модуля не ломало соседний неочевидно.

## AI <-> Billing

Публичный boundary:
- [backend/src/modules/ai/public_api.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/ai/public_api.py)
- [backend/src/modules/ai/limits.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/ai/limits.py)

Входной контракт:
- `check_ai_limits(session, org_id, user_id, estimated_request_tokens)`
- `is_org_ai_enabled(session, org_id)`

Ошибки:
- `AI_USER_RATE_LIMIT`
- `AI_ORG_DAILY_LIMIT_EXCEEDED`
- `AI_ORG_MONTHLY_LIMIT_EXCEEDED`
- `AI_DISABLED`

Retry semantics:
- нет автоматических retry на boundary check
- caller решает сам, повторять запрос или нет

Idempotency:
- сам check идемпотентен
- запись usage идёт отдельно и должна быть защищена caller-side логикой

Observability:
- ошибки lookup логируются в `ai.limits`
- e2e coverage: [backend/tests/integration/test_ai_limits_billing_payments_e2e.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/tests/integration/test_ai_limits_billing_payments_e2e.py)

## Docs <-> Storage / OnlyOffice / Antivirus

Публичные boundaries:
- storage: [backend/src/modules/docs/storage.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/docs/storage.py)
- onlyoffice: [backend/src/modules/docs/doc_editor_provider.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/docs/doc_editor_provider.py)
- antivirus: [backend/src/modules/docs/antivirus.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/docs/antivirus.py)

Входной контракт:
- presigned upload/download URLs
- internal signed download for OnlyOffice
- scan result contract: `clean|infected|blocked`

Ошибки:
- `STORAGE_URL_ERROR`
- `ONLYOFFICE_*`
- `FILE_NOT_READY`
- `INVALID_FILE_TYPE`

Retry semantics:
- enqueue scan fallback: Celery -> inline fallback in routes for critical path
- cleanup tasks use shared retry/logging base

Idempotency:
- `scan_version` safe for repeated execution on already-finalized statuses
- retention cleanup batched and repeat-safe

Observability:
- docs metrics for uploads, scans, retention cleanup
- task failure logging via infrastructure task logging helper
- coverage: [backend/src/modules/docs/tests/test_docs_api.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/docs/tests/test_docs_api.py)

## Notifications <-> SMTP / Retry Policy

Публичный boundary:
- [backend/src/modules/notifications/public_api.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/notifications/public_api.py)
- task implementation: [backend/src/modules/notifications/tasks.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/notifications/tasks.py)

Входной контракт:
- `queue_email_notification(...)`
- `queue_invite_email(...)`
- `queue_password_reset_email(...)`

Ошибки:
- enqueue errors -> `NotificationEnqueueResult(queued=False, reason="enqueue_failed")`
- SMTP permanent config errors do not retry
- SMTP transport errors do retry

Retry semantics:
- enqueue boundary itself не retry'ит
- SMTP retry живёт только внутри notification tasks

Idempotency:
- invite pre-send validation suppresses stale/duplicate sends
- generic email enqueue assumes caller-level dedupe where needed

Observability:
- `NOTIFICATION_EMAIL_SEND_TOTAL`
- `INVITE_EMAIL_VALIDATION_TOTAL`
- structured logs in `notifications.tasks`

## Superadmin <-> Runtime Config

Публичные boundaries:
- AI runtime config: [backend/src/modules/superadmin/services/ai_config.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/superadmin/services/ai_config.py)
- Billing runtime config: [backend/src/modules/billing/runtime_config.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/billing/runtime_config.py)

Входной контракт:
- superadmin updates runtime rows/secrets in DB
- consumers read resolved effective config with env fallback

Ошибки:
- invalid runtime values -> validation at schema/service layer
- missing runtime secret -> fallback to env

Retry semantics:
- none; admin updates are synchronous DB operations

Idempotency:
- repeated update with same payload is safe
- runtime secret overwrite is last-write-wins

Observability:
- runtime audit tables for AI and billing

## Billing <-> Notifications

Публичный boundary:
- billing calls only [backend/src/modules/notifications/public_api.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/notifications/public_api.py)

Входной контракт:
- billing lifecycle produces in-app notifications and optional email enqueue

Ошибки:
- enqueue fail does not rollback lifecycle state transitions

Retry semantics:
- lifecycle itself does not retry email enqueue in-band
- downstream notification task owns SMTP retry policy

Idempotency:
- repeated lifecycle run should not create duplicate reminders before reminder window elapses

Observability:
- billing lifecycle stats
- notification enqueue logs

## Existing Critical Flow Coverage

- payment -> subscription state -> reminders -> downgrade -> trim
  [backend/src/modules/billing/tests/test_billing_api.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/billing/tests/test_billing_api.py)
- docs upload -> scan -> versioning -> retention cleanup
  [backend/src/modules/docs/tests/test_docs_api.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/docs/tests/test_docs_api.py)
- SMTP temporary fail vs permanent fail
  [backend/src/modules/notifications/tests/test_notifications_tasks.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/notifications/tests/test_notifications_tasks.py)
- AI blocked/unblocked by billing and token state
  [backend/tests/integration/test_ai_limits_billing_payments_e2e.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/tests/integration/test_ai_limits_billing_payments_e2e.py)
