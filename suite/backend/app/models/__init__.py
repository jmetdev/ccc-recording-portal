import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TenantStatus(str, enum.Enum):
    PENDING = "pending"
    ACTIVE = "active"
    SUSPENDED = "suspended"


class App(str, enum.Enum):
    RECORDING = "recording"
    FAX = "fax"
    SPAM = "spam"


class SuiteTenant(Base):
    __tablename__ = "suite_tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Populated when the pre-registered admin's first Webex login binds this
    # tenant (see /api/me/link). Unique so the org<->tenant mapping stays 1:1.
    webex_org_id: Mapped[str | None] = mapped_column(String(128), unique=True, index=True)
    status: Mapped[TenantStatus] = mapped_column(
        Enum(TenantStatus, name="tenant_status_enum", native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=TenantStatus.PENDING,
        nullable=False,
    )
    # The customer admin Jeff registers at create time; the first Webex login
    # whose token email matches this (case-insensitively) may claim the tenant.
    admin_email: Mapped[str] = mapped_column(String(255), nullable=False)
    linked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    entitlements: Mapped[list["Entitlement"]] = relationship(
        back_populates="tenant", cascade="all, delete-orphan", lazy="selectin"
    )


class Entitlement(Base):
    __tablename__ = "entitlements"
    __table_args__ = (UniqueConstraint("tenant_id", "app", name="uq_entitlement_tenant_app"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("suite_tenants.id", ondelete="CASCADE"), nullable=False)
    app: Mapped[App] = mapped_column(
        Enum(App, name="entitlement_app_enum", native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    licensed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    plan_name: Mapped[str | None] = mapped_column(String(64))
    limits_json: Mapped[dict | None] = mapped_column(JSONB)

    tenant: Mapped["SuiteTenant"] = relationship(back_populates="entitlements")
