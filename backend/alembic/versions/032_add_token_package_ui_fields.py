"""add token package ui fields

Revision ID: 032
Revises: 8ebdb9b7ceef
Create Date: 2026-03-07 22:15:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "032"
down_revision = "8ebdb9b7ceef"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("token_packages", sa.Column("badge_text", sa.String(length=120), nullable=True))
    op.add_column("token_packages", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("token_packages", sa.Column("button_text", sa.String(length=120), nullable=True))
    op.add_column("token_packages", sa.Column("payment_note", sa.Text(), nullable=True))
    op.add_column("token_packages", sa.Column("price_caption", sa.String(length=255), nullable=True))

    op.execute(
        """
        UPDATE token_packages
        SET
          badge_text = CASE code
            WHEN 'pack_50k' THEN 'На пробу'
            WHEN 'pack_100k' THEN 'Для регулярной работы'
            WHEN 'pack_500k' THEN 'Самый выгодный'
            ELSE COALESCE(badge_text, 'Пакет токенов')
          END,
          description = CASE code
            WHEN 'pack_50k' THEN 'Чтобы быстро докупить токены и продолжить работу.'
            WHEN 'pack_100k' THEN 'Оптимальный пакет для постоянной нагрузки.'
            WHEN 'pack_500k' THEN 'Лучший вариант, если AI используете регулярно.'
            ELSE description
          END,
          button_text = COALESCE(button_text, 'Перейти к оплате'),
          payment_note = COALESCE(payment_note, 'После оплаты токены сразу появятся в кабинете и начнут списываться раньше тарифного лимита.'),
          price_caption = CASE code
            WHEN 'pack_50k' THEN '20 ₽ за 1 000 токенов'
            WHEN 'pack_100k' THEN '18 ₽ за 1 000 токенов'
            WHEN 'pack_500k' THEN '16 ₽ за 1 000 токенов'
            ELSE price_caption
          END
        """
    )


def downgrade() -> None:
    op.drop_column("token_packages", "price_caption")
    op.drop_column("token_packages", "payment_note")
    op.drop_column("token_packages", "button_text")
    op.drop_column("token_packages", "description")
    op.drop_column("token_packages", "badge_text")
