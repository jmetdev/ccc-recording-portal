import asyncio
from typing import Any

from fastapi import WebSocket


class LiveHub:
    """Per-tenant fan-out of live call events to connected websockets."""

    def __init__(self) -> None:
        self._connections: dict[WebSocket, int] = {}
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, tenant_id: int, *, subprotocol: str | None = None) -> None:
        await ws.accept(subprotocol=subprotocol)
        async with self._lock:
            self._connections[ws] = tenant_id

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.pop(ws, None)

    async def broadcast(self, message: dict[str, Any], tenant_id: int) -> None:
        dead: list[WebSocket] = []
        async with self._lock:
            conns = [ws for ws, tid in self._connections.items() if tid == tenant_id]
        for ws in conns:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)


live_hub = LiveHub()
