# Integration Contracts

Коротко: соседние модули должны ходить друг к другу только через публичные boundary-файлы, а не напрямую во внутренние task/service куски.

## Публичные boundary-точки

- AI: [backend/src/modules/ai/public_api.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/ai/public_api.py)
- Notifications: [backend/src/modules/notifications/public_api.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/notifications/public_api.py)
- Billing runtime config: [backend/src/modules/billing/runtime_config.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/billing/runtime_config.py)
- Docs integrations:
  - [storage.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/docs/storage.py)
  - [doc_editor_provider.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/docs/doc_editor_provider.py)
  - [antivirus.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/docs/antivirus.py)

## Что зафиксировано

### AI <-> billing/docs
- AI limits и org-level AI enablement вызываются через `ai/public_api.py`
- caller получает только результат проверки и сам решает, как отвечать пользователю

### notifications <-> auth/org/billing
- enqueue email идёт через `notifications/public_api.py`
- SMTP retry живёт внутри notification tasks
- ошибки enqueue не должны ломать основной бизнес-флоу

### docs <-> storage/onlyoffice/antivirus
- docs используют отдельные integration adapters
- upload/download, scan и OnlyOffice callback имеют собственные ошибки и логи

### superadmin <-> runtime config
- superadmin меняет runtime settings в БД
- consumers читают resolved config с fallback на env

## Что тестами уже закрыто

- payment -> reminder -> downgrade -> trim
- docs upload -> scan -> versioning -> retention cleanup
- SMTP temporary fail vs permanent fail
- AI blocked/unblocked by billing and token state
- архитектурные guard-тесты на запрет прямых cross-module импортов
