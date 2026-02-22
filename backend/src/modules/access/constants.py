"""Константы модуля access."""

# IMPORTANT: синхронизировать с фронтом и проверками в других модулях.
RESOURCE_TYPES: list[str] = ["table", "knowledge", "ai", "schedule", "reports", "files"]

# Разрешенные поля прав, используемые в check_access.
PERMISSION_FIELDS: set[str] = {"can_read", "can_write", "can_delete"}

