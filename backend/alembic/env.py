import os
import sys
from contextlib import suppress
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Import all models so Alembic can detect them
import importlib
import pkgutil

import src.modules
from src.infrastructure.database import Base

for _, _module_name, _ispkg in pkgutil.iter_modules(src.modules.__path__):
    if _ispkg:
        with suppress(ModuleNotFoundError):
            importlib.import_module(f"src.modules.{_module_name}.models")
        with suppress(ModuleNotFoundError):
            importlib.import_module(f"src.modules.{_module_name}.records")


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

db_url = os.environ.get("DATABASE_URL_SYNC", config.get_main_option("sqlalchemy.url"))
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
