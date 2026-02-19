import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.infrastructure.database import Base

# Import all models so Alembic can detect them
from src.modules.auth.models import User, RefreshToken  # noqa: F401
from src.modules.org.models import Organization, Membership, Invite, Subscription  # noqa: F401
from src.modules.audit.models import AuditLog  # noqa: F401
from src.modules.notifications.models import Notification  # noqa: F401
from src.modules.files.models import File  # noqa: F401
from src.modules.tables.models import Table, Column  # noqa: F401
from src.modules.tables.records import Record  # noqa: F401
from src.modules.tables.views import TableView  # noqa: F401
from src.modules.knowledge.models import KBPage  # noqa: F401
from src.modules.billing.models import Plan  # noqa: F401
from src.modules.schedule.models import Event  # noqa: F401
from src.modules.ai.routes import AIUsageLog  # noqa: F401
from src.modules.access.models import AccessRule  # noqa: F401

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
