import asyncio
import json
from typing import Any

from fastapi import WebSocket


class LiveEventManager:
    def __init__(self) -> None:
        self.connections: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self.connections.append(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            if websocket in self.connections:
                self.connections.remove(websocket)

    async def broadcast(self, event: str, data: dict[str, Any]) -> None:
        message = json.dumps({"event": event, "data": data})
        dead: list[WebSocket] = []
        async with self._lock:
            targets = list(self.connections)
        for ws in targets:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)


live_events = LiveEventManager()
