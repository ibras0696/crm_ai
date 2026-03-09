"""Совместимость с прежним импортом runtime secret-утилит AI.

Основная реализация вынесена в общий модуль `src.common.runtime_secret`.
"""

from __future__ import annotations

from src.common.runtime_secret import decrypt_runtime_secret, encrypt_runtime_secret, mask_runtime_secret

__all__ = [
    "encrypt_runtime_secret",
    "decrypt_runtime_secret",
    "mask_runtime_secret",
]
