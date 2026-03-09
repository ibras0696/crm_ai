"""fix docs folder depth trigger

Revision ID: 034
Revises: 033
Create Date: 2026-03-09 22:15:00
"""

from alembic import op


revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION crm_enforce_folders_depth()
        RETURNS trigger AS $$
        DECLARE
            v_cursor_id uuid;
            v_cursor_parent_id uuid;
            v_cursor_org_id uuid;
            v_depth integer := 0;
        BEGIN
            IF NEW.parent_id IS NULL THEN
                RETURN NEW;
            END IF;

            IF NEW.parent_id = NEW.id THEN
                RAISE EXCEPTION 'INVALID_PARENT_SELF';
            END IF;

            v_cursor_id := NEW.parent_id;

            LOOP
                SELECT parent_id, org_id
                  INTO v_cursor_parent_id, v_cursor_org_id
                  FROM folders
                 WHERE id = v_cursor_id;

                IF v_cursor_org_id IS NULL THEN
                    RAISE EXCEPTION 'PARENT_FOLDER_NOT_FOUND';
                END IF;

                IF v_cursor_org_id <> NEW.org_id THEN
                    RAISE EXCEPTION 'PARENT_FOLDER_ORG_MISMATCH';
                END IF;

                v_depth := v_depth + 1;
                IF v_depth > 2 THEN
                    RAISE EXCEPTION 'MAX_DEPTH_EXCEEDED';
                END IF;

                EXIT WHEN v_cursor_parent_id IS NULL;
                v_cursor_id := v_cursor_parent_id;
            END LOOP;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION crm_enforce_folders_depth()
        RETURNS trigger AS $$
        DECLARE
            v_parent_parent_id uuid;
            v_parent_org_id uuid;
        BEGIN
            IF NEW.parent_id IS NULL THEN
                RETURN NEW;
            END IF;

            IF NEW.parent_id = NEW.id THEN
                RAISE EXCEPTION 'INVALID_PARENT_SELF';
            END IF;

            SELECT parent_id, org_id
              INTO v_parent_parent_id, v_parent_org_id
              FROM folders
             WHERE id = NEW.parent_id;

            IF v_parent_org_id IS NULL THEN
                RAISE EXCEPTION 'PARENT_FOLDER_NOT_FOUND';
            END IF;

            IF v_parent_org_id <> NEW.org_id THEN
                RAISE EXCEPTION 'PARENT_FOLDER_ORG_MISMATCH';
            END IF;

            IF v_parent_parent_id IS NOT NULL THEN
                RAISE EXCEPTION 'MAX_DEPTH_EXCEEDED';
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
