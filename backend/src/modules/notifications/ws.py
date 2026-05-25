import uuid
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from src.config import settings
from src.infrastructure.metrics_custom import CHAT_WS_CONNECTIONS_TOTAL, CHAT_WS_RECONNECTS_TOTAL
from src.modules.auth.security import decode_user_access_token

router = APIRouter(prefix="/ws", tags=["websockets"])


class ConnectionManager:
    def __init__(self):
        # user_id -> set of active WebSockets
        self.active_connections: dict[uuid.UUID, set[WebSocket]] = {}
        self.last_disconnect_at: dict[uuid.UUID, datetime] = {}

    async def connect(self, websocket: WebSocket, user_id: uuid.UUID):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        CHAT_WS_CONNECTIONS_TOTAL.labels(event="connected").inc()
        now = datetime.now(UTC)
        last_disconnected = self.last_disconnect_at.get(user_id)
        if last_disconnected is not None:
            reconnect_delay = now - last_disconnected
            if reconnect_delay <= timedelta(seconds=30):
                CHAT_WS_RECONNECTS_TOTAL.labels(window="lt_30s").inc()
            elif reconnect_delay <= timedelta(minutes=5):
                CHAT_WS_RECONNECTS_TOTAL.labels(window="lt_5m").inc()

    def disconnect(self, websocket: WebSocket, user_id: uuid.UUID):
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                self.active_connections.pop(user_id, None)
        self.last_disconnect_at[user_id] = datetime.now(UTC)
        CHAT_WS_CONNECTIONS_TOTAL.labels(event="disconnected").inc()

    async def send_personal_message(self, message: dict, user_id: uuid.UUID):
        if user_id in self.active_connections:
            to_remove = set()
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except (RuntimeError, WebSocketDisconnect):
                    to_remove.add(connection)
            for connection in to_remove:
                self.disconnect(connection, user_id)

    async def broadcast(self, message: dict):
        for user_id, connections in list(self.active_connections.items()):
            to_remove = set()
            for connection in connections:
                try:
                    await connection.send_json(message)
                except (RuntimeError, WebSocketDisconnect):
                    to_remove.add(connection)
            for connection in to_remove:
                self.disconnect(connection, user_id)

    def is_online(self, user_id: uuid.UUID) -> bool:
        return bool(self.active_connections.get(user_id))


manager = ConnectionManager()


def extract_user_id(token: str | None) -> uuid.UUID | None:
    if not token:
        return None
    try:
        payload = decode_user_access_token(token)
        return uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        return None


@router.websocket("/notifications")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str | None = Query(None),
):
    # Try token from query first, then cookie
    actual_token = token
    if not actual_token:
        actual_token = websocket.cookies.get(settings.AUTH_ACCESS_COOKIE_NAME)

    user_id = extract_user_id(actual_token)

    if not user_id:
        CHAT_WS_CONNECTIONS_TOTAL.labels(event="unauthorized").inc()
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, user_id)
    try:
        while True:
            # We don't expect client to send much, maybe ping/pong
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id)
