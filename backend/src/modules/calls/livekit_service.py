import logging

from livekit.api import AccessToken, VideoGrants

from src.config import settings

logger = logging.getLogger(__name__)


class LiveKitService:
    def create_join_token(
        self,
        *,
        slug: str,
        org_id: str,
        user_id: str,
        is_host: bool,
        display_name: str | None = None,
        avatar_url: str | None = None,
    ) -> str:
        import json

        room_name = f"{org_id}:{slug}"
        grants = VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
            hidden=False,
            room_admin=is_host,
        )
        participant_name = display_name or str(user_id)
        metadata = json.dumps({"avatar_url": avatar_url}) if avatar_url else ""
        token = (
            AccessToken(
                api_key=settings.LIVEKIT_API_KEY,
                api_secret=settings.LIVEKIT_API_SECRET,
            )
            .with_identity(str(user_id))
            .with_name(participant_name)
            .with_metadata(metadata)
            .with_grants(grants)
        )
        return token.to_jwt()

    def verify_webhook(self, body: bytes, auth_header: str) -> dict:
        """Verify LiveKit webhook HMAC signature and return parsed event."""
        from livekit.api import WebhookReceiver

        receiver = WebhookReceiver(
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
        )
        # WebhookReceiver returns a protobuf WebhookEvent; convert to dict-like access
        return receiver.receive(body, auth_header)


livekit_service = LiveKitService()
