from sqlalchemy.orm import Session

from app.core.permissions import DEFAULT_ROLE_PERMISSIONS, Permission
from app.core.security import hash_password
from app.models import Group, RecordedExtension, Role, RolePermission, User, UserRole


def seed_database(db: Session) -> None:
    if db.query(User).first():
        return

    default_group = Group(name="Default")
    db.add(default_group)
    db.flush()

    roles: dict[str, Role] = {}
    for role_name, perms in DEFAULT_ROLE_PERMISSIONS.items():
        role = Role(name=role_name, description=f"{role_name.title()} role")
        db.add(role)
        db.flush()
        for perm in perms:
            db.add(RolePermission(role_id=role.id, permission=perm.value))
        roles[role_name] = role

    admin = User(
        email="admin@localhost",
        username="admin",
        password_hash=hash_password("admin123!"),
        is_active=True,
        group_id=default_group.id,
    )
    db.add(admin)
    db.flush()
    db.add(UserRole(user_id=admin.id, role_id=roles["admin"].id))

    db.add(RecordedExtension(extension="1034", label="CUCM BIB Recording", enabled=True, group_id=default_group.id))
    db.commit()
