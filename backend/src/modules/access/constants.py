"""Module-level constants for access control."""

# IMPORTANT: keep in sync with frontend and validation logic.
RESOURCE_TYPES: list[str] = ["table", "knowledge", "ai", "schedule", "reports", "files"]

# Organization membership roles that can be targets for role-based ACL rules.
# "superadmin" is global and not part of regular org membership ACL.
ACCESS_ROLES: list[str] = ["owner", "admin", "manager", "employee", "readonly"]

# Allowed permission fields used in check_access.
PERMISSION_FIELDS: set[str] = {"can_read", "can_write", "can_delete"}
