from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send


class PayloadTooLargeError(Exception):
    pass


class RequestSizeLimitMiddleware:
    """Enforce request body size for both Content-Length and chunked streams."""

    def __init__(self, app: ASGIApp, *, max_bytes: int):
        self.app = app
        self.max_bytes = int(max(0, max_bytes))

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if self.max_bytes <= 0:
            await self.app(scope, receive, send)
            return

        headers = {k.decode().lower(): v.decode() for k, v in (scope.get("headers") or [])}
        cl = headers.get("content-length")
        if cl:
            try:
                if int(cl) > self.max_bytes:
                    await self._send_413(send)
                    return
            except Exception:
                pass

        total = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                chunk = message.get("body", b"")
                total += len(chunk)
                if total > self.max_bytes:
                    raise PayloadTooLargeError
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracked_send)
        except PayloadTooLargeError:
            if not response_started:
                await self._send_413(send)

    @staticmethod
    async def _send_413(send: Send) -> None:
        payload = b'{"ok":false,"data":null,"error":{"code":"REQUEST_TOO_LARGE","message":"Request too large"}}'
        await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": payload, "more_body": False})
