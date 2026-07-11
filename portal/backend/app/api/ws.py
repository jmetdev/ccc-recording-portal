from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import decode_token, is_token_type
from app.services.live_hub import live_hub

router = APIRouter(tags=["ws"])


@router.websocket("/ws/live")
async def ws_live(websocket: WebSocket, token: str | None = None):
    # The access token travels as a WebSocket subprotocol (client passes it as
    # the `protocols` argument), not a query string, so it never lands in
    # server access logs or browser history. The `token` query param is kept
    # only as a fallback for older clients.
    subprotocols = websocket.scope.get("subprotocols") or []
    ws_token = subprotocols[0] if subprotocols else token
    if not ws_token:
        await websocket.close(code=4401)
        return
    try:
        payload = decode_token(ws_token)
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

    await live_hub.connect(websocket, int(tenant_id), subprotocol=subprotocols[0] if subprotocols else None)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await live_hub.disconnect(websocket)
