import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from passlib.context import CryptContext

from src.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: uuid.UUID, org_id: uuid.UUID | None = None, role: str | None = None) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": "access",
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE_USER,
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    if org_id:
        payload["org_id"] = str(org_id)
    if role:
        payload["role"] = role
    return jwt.encode(payload, _jwt_user_secret(), algorithm=settings.JWT_ALGORITHM)


def create_superadmin_access_token() -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": "superadmin",
        "role": "superadmin",
        "type": "access",
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE_SUPERADMIN,
        "iat": now,
        "exp": now + timedelta(hours=12),
    }
    return jwt.encode(payload, _jwt_superadmin_secret(), algorithm=settings.JWT_ALGORITHM)


def create_refresh_token() -> tuple[str, str]:
    """Returns (raw_token, token_hash)."""
    raw = uuid.uuid4().hex + uuid.uuid4().hex
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def decode_access_token(token: str) -> dict:
    return decode_user_access_token(token)


def decode_user_access_token(token: str) -> dict:
    payload = jwt.decode(
        token,
        _jwt_user_secret(),
        algorithms=[settings.JWT_ALGORITHM],
        audience=settings.JWT_AUDIENCE_USER,
        issuer=settings.JWT_ISSUER,
        options={"require": ["sub", "type", "iat", "exp", "iss", "aud"]},
    )
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Invalid token type")
    return payload


def decode_superadmin_access_token(token: str) -> dict:
    payload = jwt.decode(
        token,
        _jwt_superadmin_secret(),
        algorithms=[settings.JWT_ALGORITHM],
        audience=settings.JWT_AUDIENCE_SUPERADMIN,
        issuer=settings.JWT_ISSUER,
        options={"require": ["sub", "role", "type", "iat", "exp", "iss", "aud"]},
    )
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Invalid token type")
    return payload


def refresh_token_expires_at() -> datetime:
    return datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)


def _jwt_user_secret() -> str:
    return (settings.JWT_USER_SECRET_KEY or "").strip() or settings.SECRET_KEY


def _jwt_superadmin_secret() -> str:
    return (settings.JWT_SUPERADMIN_SECRET_KEY or "").strip() or settings.SECRET_KEY
