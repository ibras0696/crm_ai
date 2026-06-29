import logging
from datetime import UTC, datetime

from src.config import settings

logger = logging.getLogger(__name__)


class EgressService:
    """Manages LiveKit Egress recordings, storing output in MinIO (S3-compatible)."""

    async def start_room_recording(self, *, room_slug: str, org_id: str) -> tuple[str, str]:
        """Start a room composite egress recording. Returns (egress_id, file_key)."""
        from livekit.api import LiveKitAPI

        # Try the proto-based imports first (livekit-api >= 0.7), fall back to flat API imports
        try:
            from livekit.protocol.egress import (
                EncodedFileOutput,
                EncodedFileType,
                RoomCompositeEgressRequest,
                S3Upload,
            )
        except ImportError:
            # Older SDK versions expose these directly from livekit.api
            from livekit.api import (  # type: ignore[no-redef]
                EncodedFileOutput,
                EncodedFileType,
                RoomCompositeEgressRequest,
                S3Upload,
            )

        room_name = f"{org_id}:{room_slug}"
        timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        file_key = f"recordings/{org_id}/{room_slug}/{timestamp}.mp4"

        s3_upload = S3Upload(
            access_key=settings.S3_ACCESS_KEY,
            secret=settings.S3_SECRET_KEY,
            bucket=settings.S3_BUCKET,
            endpoint=settings.S3_ENDPOINT,
            region=settings.S3_REGION,
            force_path_style=True,
        )
        file_output = EncodedFileOutput(
            file_type=EncodedFileType.MP4,
            filepath=file_key,
            s3=s3_upload,
        )
        request = RoomCompositeEgressRequest(
            room_name=room_name,
            file=file_output,
        )

        async with LiveKitAPI(
            url=settings.LIVEKIT_URL,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
        ) as api:
            info = await api.egress.start_room_composite_egress(request)

        logger.info("egress_started", extra={"egress_id": info.egress_id, "room": room_name})
        return info.egress_id, file_key

    async def stop_recording(self, *, egress_id: str) -> None:
        """Stop an active egress."""
        from livekit.api import LiveKitAPI

        async with LiveKitAPI(
            url=settings.LIVEKIT_URL,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
        ) as api:
            await api.egress.stop_egress(egress_id)

        logger.info("egress_stopped", extra={"egress_id": egress_id})


egress_service = EgressService()
