"""OAuth login endpoints for Webex / Zoom (server-side authorization-code flow).

  GET /auth/oauth/{provider}/login     -> 302 to the provider's consent screen
  GET /auth/oauth/{provider}/callback  -> exchange code, provision user, 302 back
                                          to the SPA with portal tokens in the
                                          URL fragment.
"""

from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.oauth import (
    exchange_and_fetch,
    get_provider,
    make_state,
    redirect_uri,
    resolve_user,
    verify_state,
)
from app.core.security import create_access_token, create_refresh_token
from app.services.audit import record_audit

router = APIRouter(prefix="/auth/oauth", tags=["oauth"])


def _origin(request: Request) -> str:
    return f"{request.url.scheme}://{request.url.netloc}"


def _spa_base(request: Request) -> str:
    return (settings.public_base_url or _origin(request)).rstrip("/")


@router.get("/{provider}/login")
async def oauth_login(provider: str, request: Request):
    p = get_provider(provider)
    params = {
        "response_type": "code",
        "client_id": p.client_id,
        "redirect_uri": redirect_uri(provider, _origin(request)),
        "scope": p.scopes,
        "state": make_state(provider),
    }
    return RedirectResponse(f"{p.authorize_url}?{urlencode(params)}")


@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str,
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    base = _spa_base(request)
    if error or not code or not state:
        return RedirectResponse(f"{base}/login?error={error or 'oauth_failed'}")

    p = get_provider(provider)
    verify_state(state, provider)
    ident = await exchange_and_fetch(p, code, redirect_uri(provider, _origin(request)))
    user = await resolve_user(db, provider, ident)
    if not user.is_active:
        return RedirectResponse(f"{base}/login?error=user_inactive")

    await record_audit(
        db,
        tenant_id=user.tenant_id,
        action="auth.login_oauth",
        user=user,
        resource_type="user",
        resource_id=user.id,
        request=request,
        commit=True,
    )
    fragment = urlencode(
        {
            "access_token": create_access_token(str(user.id), tenant_id=user.tenant_id),
            "refresh_token": create_refresh_token(str(user.id)),
        }
    )
    return RedirectResponse(f"{base}/auth/oauth-callback#{fragment}")
