from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import decode_token, is_token_type
from app.services.live_hub import live_hub

router = APIRouter(tags=["ws"])


@router.websocket("/ws/live")
async def ws_live(websocket: WebSocket, token: str | None = None):
    if token:
        try:
            payload = decode_token(token)
            if not is_token_type(payload, "access"):
                await websocket.close(code=4401)
                return
        except Exception:
            await websocket.close(code=4401)
            return

    await live_hub.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await live_hub.disconnect(websocket)
