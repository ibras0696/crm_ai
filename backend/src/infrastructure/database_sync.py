from __future__ import annotations

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from src.config import settings

_engine = None
_session_factory: sessionmaker[Session] | None = None
_owner_pid: int | None = None


def _is_stale_process() -> bool:
    return _owner_pid is not None and _owner_pid != os.getpid()


def _build_engine():
    return create_engine(
        settings.DATABASE_URL_SYNC,
        echo=settings.DB_ECHO,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_timeout=settings.DB_POOL_TIMEOUT_S,
        pool_recycle=settings.DB_POOL_RECYCLE_S,
        pool_pre_ping=True,
        future=True,
    )


def get_sync_engine():
    global _engine, _session_factory, _owner_pid
    if _engine is None or _session_factory is None or _is_stale_process():
        _engine = _build_engine()
        _session_factory = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)
        _owner_pid = os.getpid()
    return _engine


def get_sync_session_factory() -> sessionmaker[Session]:
    get_sync_engine()
    assert _session_factory is not None
    return _session_factory


def sync_session_factory() -> Session:
    return get_sync_session_factory()()


def get_sync_session() -> Generator[Session, None, None]:
    session = sync_session_factory()
    try:
        yield session
    finally:
        session.close()
