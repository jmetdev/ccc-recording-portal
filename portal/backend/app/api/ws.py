from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import decode_token, is_token_type
from app.services.live_hub import live_hub

router = APIRouter(tags=["ws"])


@router.websocket("/ws/live")
async def ws_live(websocket: WebSocket, token: str | None = None):
    # Auth is mandatory: live events are tenant-scoped, so an anonymous socket
    # has no tenant to subscribe to.
    if not token:
        await websocket.close(code=4401)
        return
    try:
        payload = decode_token(token)
        if not is_token_type(payload, "access"):
            await websocket.close(code=4401)
            return
        tenant_id = payload.get("tid")
        if tenant_id is None:
            await websocket.close(code=4401)
            return
    except Exception:
        await websocket.close(code=4401)
        return

    await live_hub.connect(websocket, int(tenant_id))
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await live_hub.disconnect(websocket)
