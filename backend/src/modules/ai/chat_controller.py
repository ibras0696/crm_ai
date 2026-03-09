"""Публичный фасад контроллера AI-чата.

Оркестрация чата вынесена в `src.modules.ai.internal.chat_controller`, чтобы
корень модуля `ai` оставался компактным.
"""

from src.modules.ai.internal.chat_controller import run_ai_chat  # noqa: F401

__all__ = ["run_ai_chat"]
