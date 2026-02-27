"""Общие утилиты шифрования runtime-секретов.

Секреты шифруются симметрично на стороне приложения и хранятся в БД только
в зашифрованном виде. Полное значение секрета не должно уходить в API-ответы.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

from src.config import settings

_NONCE_SIZE = 16
_TAG_SIZE = 32


def _derive_key() -> bytes:
    raw = (
        (settings.JWT_SUPERADMIN_SECRET_KEY or "").strip()
        or (settings.SECRET_KEY or "").strip()
        or "dev-secret"
    )
    return hashlib.sha256(raw.encode("utf-8")).digest()


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        block = hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


def encrypt_runtime_secret(plain_text: str) -> str:
    text = str(plain_text or "")
    if not text:
        return ""
    key = _derive_key()
    nonce = secrets.token_bytes(_NONCE_SIZE)
    plain = text.encode("utf-8")
    stream = _keystream(key, nonce, len(plain))
    cipher = bytes(a ^ b for a, b in zip(plain, stream, strict=True))
    tag = hmac.new(key, nonce + cipher, hashlib.sha256).digest()
    payload = base64.urlsafe_b64encode(nonce + cipher + tag).decode("ascii")
    return f"v1:{payload}"


def decrypt_runtime_secret(sealed_text: str) -> str:
    raw = str(sealed_text or "").strip()
    if not raw or not raw.startswith("v1:"):
        return ""
    payload = raw[3:]
    try:
        data = base64.urlsafe_b64decode(payload.encode("ascii"))
    except Exception:
        return ""
    if len(data) <= (_NONCE_SIZE + _TAG_SIZE):
        return ""
    nonce = data[:_NONCE_SIZE]
    tag = data[-_TAG_SIZE:]
    cipher = data[_NONCE_SIZE:-_TAG_SIZE]
    key = _derive_key()
    expected = hmac.new(key, nonce + cipher, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, tag):
        return ""
    stream = _keystream(key, nonce, len(cipher))
    plain = bytes(a ^ b for a, b in zip(cipher, stream, strict=True))
    try:
        return plain.decode("utf-8")
    except Exception:
        return ""


def mask_runtime_secret(value: str) -> str:
    token = str(value or "").strip()
    if not token:
        return ""
    if len(token) <= 8:
        return token[:2] + "***"
    return f"{token[:4]}***{token[-4:]}"
