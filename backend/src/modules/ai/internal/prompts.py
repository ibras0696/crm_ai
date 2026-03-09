"""Централизованные промпты и текстовые шаблоны AI-модуля."""

from __future__ import annotations

ACTION_INSTRUCTIONS_PROMPT = (
    "IMPORTANT:\n"
    "- Only append ONE final ```crm_action``` block at the end of your answer.\n"
    "- If user did not explicitly ask to create/change entities, do NOT append crm_action.\n"
    "- If the user asks for a dashboard/report, do NOT modify tables. Return create_dashboard only.\n"
    "- Do NOT create columns/records unless the user explicitly asked to change/fill a table.\n"
    "- For dashboards: explain in simple business language what is on horizontal axis, "
    "vertical axis and what filters are applied.\n"
    "- For dashboards: use only existing table/column names from context. "
    "Never invent missing columns.\n"
    "- If columns are not enough for requested dashboard, ask a short clarifying question "
    "instead of generating fake config.\n"
    "- Prefer human-friendly keys in action payload "
    "(for schedule: дата/время/повтор/цвет/напоминания).\n"
    "- Never dump huge JSON in the normal text. Put the action JSON ONLY inside the final "
    "```crm_action``` block.\n"
    "- If user explicitly asks for many rows (100/500/1000), return records in action payload "
    "up to real system limits.\n"
    "- For table rows ALWAYS use compact records format ONLY: "
    "records={columns:[...],rows:[[...],[...]]}. NEVER use list of objects for records.\n"
    "If user asks to create dashboard/report, append final block:\n"
    "```crm_action\n"
    '{"action":"create_dashboard","name":"...","description":"...","widgets":[...]}\n'
    "```"
    "\nIf user asks to create a table, append final block:\n"
    "```crm_action\n"
    '{"action":"create_table","name":"...","description":"...","columns":[{"name":"...","field_type":"text"}],"records":{"columns":["Название"],"rows":[["..."]]}}\n'
    "```"
    "\nIf user asks to add columns to an existing table, append final block:\n"
    "```crm_action\n"
    '{"action":"create_columns","table_name":"...","columns":[{"name":"...","field_type":"number"}]}\n'
    "```"
    "\nIf user asks to fill table rows, append final block:\n"
    "```crm_action\n"
    '{"action":"create_records","table_name":"...","records":{"columns":["Column"],"rows":[["Value"]]}}\n'
    "```"
    "\nIf user asks to create a schedule event, append final block:\n"
    "```crm_action\n"
    '{"action":"create_schedule_event","events":[{"title":"...","start_at":"2026-01-01T10:00:00Z",'
    '"end_at":"2026-01-01T11:00:00Z","recurrence":"weekly","color":"#3b82f6",'
    '"participants":["user@example.com","Иван Иванов"],"reminder_offsets_minutes":[60,1440]}]}\n'
    "```"
    "\nIf user asks to create a knowledge base page, append final block:\n"
    "```crm_action\n"
    '{"action":"create_kb_page","title":"Курс Python","content":"Описание курса",'
    '"pages":[{"title":"Урок 1","content":"..."},{"title":"Урок 2","content":"..."}]}\n'
    "```"
    "\nIf user asks to create a document, append final block:\n"
    "```crm_action\n"
    '{"action":"create_document","type":"docx","title":"Коммерческое предложение",'
    '"template":"business","prompt":"Подготовь коммерческое предложение для клиента..."}\n'
    "```"
)

JSON_REPAIR_SYSTEM_PROMPT = (
    "Ты валидатор JSON-действий CRM. "
    "Верни только один валидный JSON-объект действия. "
    "Без комментариев, без markdown, без лишнего текста."
)

ACTION_SYNTH_SYSTEM_PROMPT = (
    "Ты арбитр действий CRM. "
    "Проанализируй сообщение пользователя и ответ ассистента. "
    "Если действительно нужно выполнить действие CRM (создать/изменить сущность), "
    "верни ОДИН валидный JSON-объект действия с полем action. "
    "Если действия не требуется, верни пустой объект {}. "
    "Никакого markdown и пояснений."
)

ACTION_NOT_EXECUTED_MESSAGE = (
    "Действие не выполнено: модель не сформировала структурированную команду для системы. "
    "Повторите запрос в явном виде, например: "
    "«создай таблицу ...», «создай документ ...», «добавь N записей в таблицу ...» или "
    "«создай событие в расписании на ...»."
)

CONFIRM_TABLE_CHANGE_MESSAGE = "Подтвердите изменение таблицы: напишите «подтверждаю». " "Для отмены напишите «отмена»."


def build_repair_user_prompt(broken_reply: str) -> str:
    """Собрать user-prompt для восстановления битого action JSON.

    Args:
        broken_reply: Сырой ответ модели с поврежденным JSON.

    Returns:
        Текст запроса для repair-helper вызова.
    """
    return (
        "Преобразуй это в валидный JSON действия. "
        "Если действия нет или нельзя восстановить, верни {}.\n\n"
        f"{broken_reply}"
    )


def build_synthesis_user_prompt(user_message: str, assistant_reply: str) -> str:
    """Собрать user-prompt для синтеза отсутствующего action JSON.

    Args:
        user_message: Исходный текст пользователя.
        assistant_reply: Ответ ассистента без action-блока.

    Returns:
        Текст запроса для synthesis-helper вызова.
    """
    return (
        f"Сообщение пользователя:\n{user_message}\n\n" f"Ответ ассистента:\n{assistant_reply}\n\n" "Верни только JSON."
    )
