"""seed billing defaults

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-26 18:30:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO plans (
            id,
            name,
            display_name,
            price_monthly,
            price_yearly,
            max_members,
            max_tables,
            max_records,
            max_storage_mb,
            has_ai,
            ai_max_tokens_per_request,
            ai_tokens_per_day,
            ai_rpm_per_user,
            features,
            is_active,
            deleted_at
        )
        VALUES
        (
            '00000000-0000-4000-8000-000000000001',
            'free',
            'Бесплатный',
            0,
            0,
            10,
            10,
            10000,
            500,
            true,
            2000,
            20000,
            10,
            '{"search": true, "filter": true, "export_csv": true, "ai": true}'::jsonb,
            true,
            NULL
        ),
        (
            '00000000-0000-4000-8000-000000000002',
            'team',
            'Команда',
            149000,
            1190000,
            50,
            100,
            200000,
            10240,
            true,
            2000,
            200000,
            30,
            '{"search": true, "filter": true, "export_csv": true, "ai": true}'::jsonb,
            true,
            NULL
        ),
        (
            '00000000-0000-4000-8000-000000000003',
            'business',
            'Бизнес',
            499000,
            3990000,
            200,
            500,
            2000000,
            102400,
            true,
            2000,
            500000,
            60,
            '{"search": true, "filter": true, "export_csv": true, "ai": true, "priority_support": true}'::jsonb,
            true,
            NULL
        )
        ON CONFLICT (name) DO UPDATE
        SET
            display_name = EXCLUDED.display_name,
            price_monthly = EXCLUDED.price_monthly,
            price_yearly = EXCLUDED.price_yearly,
            max_members = EXCLUDED.max_members,
            max_tables = EXCLUDED.max_tables,
            max_records = EXCLUDED.max_records,
            max_storage_mb = EXCLUDED.max_storage_mb,
            has_ai = EXCLUDED.has_ai,
            ai_max_tokens_per_request = EXCLUDED.ai_max_tokens_per_request,
            ai_tokens_per_day = EXCLUDED.ai_tokens_per_day,
            ai_rpm_per_user = EXCLUDED.ai_rpm_per_user,
            features = EXCLUDED.features,
            is_active = EXCLUDED.is_active,
            deleted_at = NULL,
            updated_at = now();
        """
    )

    op.execute(
        """
        INSERT INTO token_packages (
            id,
            code,
            display_name,
            badge_text,
            description,
            button_text,
            payment_note,
            price_caption,
            tokens,
            price_rub_cents,
            is_active,
            sort_order,
            deleted_at
        )
        VALUES
        (
            '00000000-0000-4000-8000-000000000011',
            'pack_50k',
            'Пакет 50k',
            'На пробу',
            'Чтобы быстро докупить токены и продолжить работу.',
            'Перейти к оплате',
            'После оплаты токены сразу появятся в кабинете и начнут списываться раньше тарифного лимита.',
            '20 ₽ за 1 000 токенов',
            50000,
            99000,
            true,
            10,
            NULL
        ),
        (
            '00000000-0000-4000-8000-000000000012',
            'pack_100k',
            'Пакет 100k',
            'Для регулярной работы',
            'Оптимальный пакет для постоянной нагрузки.',
            'Перейти к оплате',
            'После оплаты токены сразу появятся в кабинете и начнут списываться раньше тарифного лимита.',
            '18 ₽ за 1 000 токенов',
            100000,
            179000,
            true,
            20,
            NULL
        ),
        (
            '00000000-0000-4000-8000-000000000013',
            'pack_500k',
            'Пакет 500k',
            'Самый выгодный',
            'Лучший вариант, если AI используете регулярно.',
            'Перейти к оплате',
            'После оплаты токены сразу появятся в кабинете и начнут списываться раньше тарифного лимита.',
            '16 ₽ за 1 000 токенов',
            500000,
            799000,
            true,
            30,
            NULL
        )
        ON CONFLICT (code) DO UPDATE
        SET
            display_name = EXCLUDED.display_name,
            badge_text = EXCLUDED.badge_text,
            description = EXCLUDED.description,
            button_text = EXCLUDED.button_text,
            payment_note = EXCLUDED.payment_note,
            price_caption = EXCLUDED.price_caption,
            tokens = EXCLUDED.tokens,
            price_rub_cents = EXCLUDED.price_rub_cents,
            is_active = EXCLUDED.is_active,
            sort_order = EXCLUDED.sort_order,
            deleted_at = NULL,
            updated_at = now();
        """
    )


def downgrade() -> None:
    # Keep downgrade non-destructive: seeded rows may have been changed by admins after creation.
    pass
