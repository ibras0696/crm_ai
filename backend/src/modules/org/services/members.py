import uuid

from src.common.enums import AuditAction, UserRole
from src.common.exceptions import NotFoundError, ValidationError
from src.infrastructure.uow import UnitOfWork
from src.modules.audit.repository import AuditRepository
from src.modules.org.repository import MembershipRepository


class OrgMembersService:
    """Organization members management use-cases."""

    async def update_member_role(
        self,
        *,
        org_id: uuid.UUID,
        membership_id: uuid.UUID,
        new_role: UserRole,
        actor_id: uuid.UUID,
        ip_address: str | None = None,
    ) -> None:
        async with UnitOfWork() as uow:
            member_repo = MembershipRepository(uow.session)
            audit_repo = AuditRepository(uow.session)

            membership = await member_repo.get_by_id_for_org(membership_id, org_id)
            if membership is None:
                raise NotFoundError("Membership")

            if membership.role == UserRole.OWNER and new_role != UserRole.OWNER:
                owner_count = await member_repo.count_org_owners(org_id)
                if owner_count <= 1:
                    raise ValidationError("Cannot remove the last owner of an organization")

            old_role = membership.role
            await member_repo.update_role(membership_id, new_role)

            await audit_repo.log(
                org_id=org_id,
                actor_id=actor_id,
                action=AuditAction.ROLE_CHANGED,
                entity_type="membership",
                entity_id=str(membership_id),
                meta={"old_role": old_role.value, "new_role": new_role.value, "user_id": str(membership.user_id)},
                ip_address=ip_address,
            )

            await uow.commit()

    async def remove_member(
        self,
        *,
        org_id: uuid.UUID,
        membership_id: uuid.UUID,
        actor_id: uuid.UUID,
        ip_address: str | None = None,
    ) -> None:
        async with UnitOfWork() as uow:
            member_repo = MembershipRepository(uow.session)
            audit_repo = AuditRepository(uow.session)

            membership = await member_repo.get_by_id_for_org(membership_id, org_id)
            if membership is None:
                raise NotFoundError("Membership")

            if membership.role == UserRole.OWNER:
                owner_count = await member_repo.count_org_owners(org_id)
                if owner_count <= 1:
                    raise ValidationError("Cannot remove the last owner")

            await member_repo.delete(membership)

            await audit_repo.log(
                org_id=org_id,
                actor_id=actor_id,
                action=AuditAction.DELETE,
                entity_type="membership",
                entity_id=str(membership_id),
                meta={"removed_user_id": str(membership.user_id)},
                ip_address=ip_address,
            )

            await uow.commit()
