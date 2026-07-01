from enum import Enum


class Permission(str, Enum):
    VIEW_ALL_CALLS = "view_all_calls"
    VIEW_GROUP_CALLS = "view_group_calls"
    MANAGE_USERS = "manage_users"
    MANAGE_TAGS = "manage_tags"
    VIEW_TRANSCRIPTS = "view_transcripts"
    MANAGE_EXTENSIONS = "manage_extensions"
    MANAGE_ROLES = "manage_roles"


DEFAULT_ROLE_PERMISSIONS: dict[str, list[Permission]] = {
    "admin": list(Permission),
    "supervisor": [
        Permission.VIEW_ALL_CALLS,
        Permission.MANAGE_TAGS,
        Permission.VIEW_TRANSCRIPTS,
    ],
    "agent": [
        Permission.VIEW_GROUP_CALLS,
        Permission.MANAGE_TAGS,
        Permission.VIEW_TRANSCRIPTS,
    ],
}
