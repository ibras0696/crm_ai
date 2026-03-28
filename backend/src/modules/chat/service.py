import uuid
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import ClassVar

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.modules.chat.errors import ChatModuleError
from src.modules.chat.models import Chat, ChatMember, ChatMessage, ChatUploadSession
from src.modules.chat.repository import ChatRepository
from src.modules.chat.schemas import (
    CHAT_MESSAGE_MAX_CHARS,
    AddChatMemberRequest,
    ChatAttachmentFinishRequest,
    ChatAttachmentInitRequest,
    CreateChatRequest,
    SendChatMessageRequest,
    UpdateChatRequest,
)
from src.modules.files import storage as files_storage
from src.modules.files.models import File
from src.modules.files.repository import FileRepository


class ChatServiceError(ChatModuleError):
    def __init__(self, *, code: str, message: str, status_code: int = 422):
        super().__init__(code=code, message=message, status_code=status_code)


class ChatService:
    CHAT_WRITE_ROLES: ClassVar[set[str]] = {"owner", "admin", "member"}
    CHAT_ADMIN_ROLES: ClassVar[set[str]] = {"owner", "admin"}
    CHAT_ALLOWED_ATTACHMENT_STATUSES: ClassVar[set[str]] = {"ready"}
    VOICE_NOTE_MAX_DURATION_MS: ClassVar[int] = 60_000

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = ChatRepository(session)
        self.files_repo = FileRepository(session)

    async def create_chat(self, *, org_id: uuid.UUID, actor_id: uuid.UUID, body: CreateChatRequest) -> Chat:
        chat_type = body.chat_type
        title = (body.title or "").strip() or None
        member_ids = self._dedup_ids([actor_id, *(body.member_ids or [])])

        if chat_type in {"group", "channel"} and not title:
            raise ChatServiceError(code="VALIDATION_ERROR", message="title обязателен для group/channel")
        if chat_type == "direct" and len(member_ids) != 2:
            raise ChatServiceError(code="VALIDATION_ERROR", message="direct чат должен содержать ровно 2 участников")

        for member_id in member_ids:
            if not await self.repo.is_org_member(org_id=org_id, user_id=member_id):
                raise ChatServiceError(code="INVALID_MEMBER", message="Пользователь не состоит в организации")

        chat = Chat(org_id=org_id, created_by=actor_id, chat_type=chat_type, title=title)
        await self.repo.create_chat(chat)
        members = [
            ChatMember(
                org_id=org_id,
                chat_id=chat.id,
                user_id=user_id,
                role="owner" if user_id == actor_id else "member",
            )
            for user_id in member_ids
        ]
        await self.repo.add_members(members)
        return chat

    async def list_user_chats(self, *, org_id: uuid.UUID, user_id: uuid.UUID, limit: int, offset: int) -> list[Chat]:
        return await self.repo.list_user_chats(org_id=org_id, user_id=user_id, limit=limit, offset=offset)

    async def get_chat_for_user(self, *, chat_id: uuid.UUID, org_id: uuid.UUID, user_id: uuid.UUID) -> Chat | None:
        return await self.repo.get_chat_for_user(chat_id=chat_id, org_id=org_id, user_id=user_id)

    async def get_member_ids(self, *, chat_id: uuid.UUID) -> list[uuid.UUID]:
        return await self.repo.list_member_ids(chat_id=chat_id)

    async def list_members_for_user(self, *, chat: Chat, user_id: uuid.UUID) -> list[ChatMember]:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=user_id)
        if member is None:
            raise ChatServiceError(code="FORBIDDEN", message="Нет доступа к чату", status_code=403)
        return await self.repo.list_members(chat_id=chat.id)

    async def update_chat(
        self, *, chat: Chat, actor_id: uuid.UUID, body: UpdateChatRequest
    ) -> Chat:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=actor_id)
        if member is None or member.role not in self.CHAT_ADMIN_ROLES:
            raise ChatServiceError(code="FORBIDDEN", message="Недостаточно прав для обновления чата", status_code=403)
        chat.title = body.title.strip()
        await self.session.flush()
        return chat

    async def add_member(
        self,
        *,
        chat: Chat,
        actor_id: uuid.UUID,
        body: AddChatMemberRequest,
    ) -> ChatMember:
        if chat.chat_type == "direct":
            raise ChatServiceError(code="VALIDATION_ERROR", message="В direct чат нельзя добавлять участников")

        actor_member = await self.repo.get_chat_member(chat_id=chat.id, user_id=actor_id)
        if actor_member is None or actor_member.role not in self.CHAT_ADMIN_ROLES:
            raise ChatServiceError(
                code="FORBIDDEN",
                message="Недостаточно прав для добавления участника",
                status_code=403,
            )

        if not await self.repo.is_org_member(org_id=chat.org_id, user_id=body.user_id):
            raise ChatServiceError(code="INVALID_MEMBER", message="Пользователь не состоит в организации")

        existing = await self.repo.get_chat_member(chat_id=chat.id, user_id=body.user_id)
        if existing is not None:
            return existing

        member = ChatMember(
            org_id=chat.org_id,
            chat_id=chat.id,
            user_id=body.user_id,
            role=body.role,
        )
        await self.repo.add_members([member])
        return member

    async def create_message(
        self,
        *,
        chat: Chat,
        actor_id: uuid.UUID,
        body: SendChatMessageRequest,
    ) -> ChatMessage:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=actor_id)
        if member is None or member.role not in self.CHAT_WRITE_ROLES:
            raise ChatServiceError(
                code="FORBIDDEN",
                message="Недостаточно прав для отправки сообщения",
                status_code=403,
            )

        attachment_ids = self._extract_attachment_ids(body.meta)
        attachments = await self._resolve_attachments_for_message(
            chat=chat,
            actor_id=actor_id,
            attachment_ids=attachment_ids,
        )
        trimmed_body = body.body.strip()
        if not trimmed_body and not attachments:
            raise ChatServiceError(code="VALIDATION_ERROR", message="Сообщение не может быть пустым")
        if len(trimmed_body) > CHAT_MESSAGE_MAX_CHARS:
            raise ChatServiceError(
                code="VALIDATION_ERROR",
                message=f"Сообщение не должно превышать {CHAT_MESSAGE_MAX_CHARS} символов",
            )
        self._validate_voice_note_meta(meta=body.meta, attachments=attachments)
        message_meta = self._normalize_message_meta(meta=body.meta, attachments=attachments)

        seq_no = await self.repo.next_seq_no(chat_id=chat.id)
        message = ChatMessage(
            org_id=chat.org_id,
            chat_id=chat.id,
            sender_id=actor_id,
            seq_no=seq_no,
            body=trimmed_body,
            body_type=(body.body_type or "text_markdown").strip(),
            meta=message_meta,
        )
        return await self.repo.create_message(message)

    async def init_attachment_upload(
        self,
        *,
        chat: Chat,
        actor_id: uuid.UUID,
        body: ChatAttachmentInitRequest,
    ) -> dict:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=actor_id)
        if member is None or member.role not in self.CHAT_WRITE_ROLES:
            raise ChatServiceError(
                code="FORBIDDEN",
                message="Недостаточно прав для загрузки вложений",
                status_code=403,
            )

        filename = body.filename.strip()
        content_type = body.content_type.strip().lower()
        if not filename:
            raise ChatServiceError(code="VALIDATION_ERROR", message="filename не может быть пустым")
        if not content_type:
            raise ChatServiceError(code="VALIDATION_ERROR", message="content_type не может быть пустым")

        allowed_mimes = self._attachment_allowed_mime_types()
        if allowed_mimes and content_type not in allowed_mimes:
            raise ChatServiceError(code="UNSUPPORTED_MIME", message="Недопустимый тип вложения")

        size_bytes = int(body.size_bytes)
        max_upload_bytes = int(max(1, int(settings.CHAT_ATTACHMENT_MAX_UPLOAD_MB)) * 1024 * 1024)
        if size_bytes > max_upload_bytes:
            raise ChatServiceError(code="FILE_TOO_LARGE", message="Файл превышает допустимый размер")

        await self._enforce_storage_limit(org_id=chat.org_id, incoming_size=size_bytes)

        file_id = uuid.uuid4()
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
        safe_ext = ext[:20] if ext else "bin"
        s3_key = f"org/{chat.org_id}/chat/{chat.id}/attachments/{file_id.hex}.{safe_ext}"
        expires_in = int(max(60, int(settings.CHAT_ATTACHMENT_PRESIGNED_TTL_S or 900)))

        db_file = File(
            id=file_id,
            org_id=chat.org_id,
            uploaded_by=actor_id,
            filename=f"{file_id.hex}.{safe_ext}",
            original_name=filename,
            content_type=content_type,
            size=size_bytes,
            s3_key=s3_key,
            s3_bucket=settings.S3_BUCKET,
            type="chat_attachment",
            status="uploading",
            title=filename[:500],
        )
        await self.files_repo.create(db_file)

        upload = ChatUploadSession(
            org_id=chat.org_id,
            chat_id=chat.id,
            user_id=actor_id,
            file_id=file_id,
            status="uploading",
            expected_size=size_bytes,
            expected_content_type=content_type,
            expires_at=datetime.now(UTC) + timedelta(seconds=expires_in),
        )
        await self.repo.create_upload_session(upload)

        try:
            upload_url, upload_headers = files_storage.generate_presigned_put_url(
                s3_key=s3_key,
                bucket=settings.S3_BUCKET,
                content_type=content_type,
                expires_in=expires_in,
            )
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
            raise ChatServiceError(
                code="STORAGE_URL_ERROR",
                message="Не удалось сформировать ссылку на загрузку вложения",
            ) from exc
        return {
            "file_id": file_id,
            "upload_url": upload_url,
            "upload_headers": upload_headers,
            "expires_in": expires_in,
        }

    async def finish_attachment_upload(
        self,
        *,
        chat: Chat,
        actor_id: uuid.UUID,
        body: ChatAttachmentFinishRequest,
    ) -> File:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=actor_id)
        if member is None or member.role not in self.CHAT_WRITE_ROLES:
            raise ChatServiceError(
                code="FORBIDDEN",
                message="Недостаточно прав для загрузки вложений",
                status_code=403,
            )

        upload = await self.repo.get_upload_session_for_user(
            org_id=chat.org_id,
            chat_id=chat.id,
            user_id=actor_id,
            file_id=body.file_id,
        )
        if upload is None:
            raise ChatServiceError(code="NOT_FOUND", message="Сессия загрузки не найдена", status_code=404)
        if upload.status != "uploading":
            raise ChatServiceError(code="INVALID_STATUS", message="Загрузка уже завершена или отменена")
        if datetime.now(UTC) >= upload.expires_at:
            upload.status = "expired"
            await self.session.flush()
            raise ChatServiceError(code="UPLOAD_EXPIRED", message="Ссылка на загрузку истекла")

        db_file = await self.files_repo.get_by_id_for_org(file_id=body.file_id, org_id=chat.org_id)
        if db_file is None:
            raise ChatServiceError(code="NOT_FOUND", message="Файл не найден", status_code=404)
        if db_file.uploaded_by != actor_id:
            raise ChatServiceError(
                code="FORBIDDEN",
                message="Недостаточно прав для завершения загрузки",
                status_code=403,
            )
        if int(body.size_bytes) != int(upload.expected_size):
            raise ChatServiceError(code="UPLOAD_SIZE_MISMATCH", message="Размер файла не совпадает с init-upload")

        try:
            meta = files_storage.head_object(db_file.s3_key, db_file.s3_bucket)
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
            raise ChatServiceError(
                code="STORAGE_HEAD_ERROR",
                message="Не удалось проверить загруженный файл в хранилище",
            ) from exc

        uploaded_size = int(meta.get("ContentLength") or 0)
        if uploaded_size <= 0:
            raise ChatServiceError(code="UPLOAD_EMPTY", message="Файл в хранилище пустой")
        if uploaded_size != int(upload.expected_size):
            raise ChatServiceError(code="UPLOAD_SIZE_MISMATCH", message="Размер файла в хранилище не совпадает")

        db_file.status = "ready"
        db_file.size = uploaded_size
        upload.status = "ready"
        await self.session.flush()
        return db_file

    async def abort_attachment_upload(self, *, chat: Chat, actor_id: uuid.UUID, file_id: uuid.UUID) -> None:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=actor_id)
        if member is None or member.role not in self.CHAT_WRITE_ROLES:
            raise ChatServiceError(
                code="FORBIDDEN",
                message="Недостаточно прав для отмены загрузки",
                status_code=403,
            )

        upload = await self.repo.get_upload_session_for_user(
            org_id=chat.org_id,
            chat_id=chat.id,
            user_id=actor_id,
            file_id=file_id,
        )
        if upload is None:
            raise ChatServiceError(code="NOT_FOUND", message="Сессия загрузки не найдена", status_code=404)

        db_file = await self.files_repo.get_by_id_for_org(file_id=file_id, org_id=chat.org_id)
        if db_file is not None and db_file.status == "uploading":
            with suppress(BotoCoreError, ClientError, KeyError, OSError, ValueError):
                files_storage.delete_file(db_file.s3_key, db_file.s3_bucket)
            await self.files_repo.delete(db_file)

        upload.status = "aborted"
        await self.session.flush()

    async def get_attachment_download_url(
        self,
        *,
        chat: Chat,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
        expires_in: int = 600,
    ) -> str:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=user_id)
        if member is None:
            raise ChatServiceError(code="FORBIDDEN", message="Нет доступа к этому чату", status_code=403)

        upload = await self.repo.get_upload_session_for_chat_file(
            org_id=chat.org_id,
            chat_id=chat.id,
            file_id=file_id,
        )
        if upload is None or upload.status != "ready":
            raise ChatServiceError(code="NOT_FOUND", message="Вложение не найдено", status_code=404)

        db_file = await self.files_repo.get_by_id_for_org(file_id=file_id, org_id=chat.org_id)
        if db_file is None or db_file.status not in self.CHAT_ALLOWED_ATTACHMENT_STATUSES:
            raise ChatServiceError(code="NOT_FOUND", message="Вложение не готово к скачиванию", status_code=404)

        return files_storage.generate_presigned_get_url(
            s3_key=db_file.s3_key,
            bucket=db_file.s3_bucket,
            expires_in=int(max(60, expires_in)),
            filename=db_file.original_name,
            inline=True,
        )

    async def list_messages_for_user(
        self,
        *,
        chat: Chat,
        user_id: uuid.UUID,
        limit: int,
        offset: int,
        before_seq_no: int | None = None,
        latest: bool = False,
    ) -> list[ChatMessage]:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=user_id)
        if member is None:
            raise ChatServiceError(code="FORBIDDEN", message="Нет доступа к сообщениям этого чата", status_code=403)
        return await self.repo.list_messages(
            chat_id=chat.id,
            limit=limit,
            offset=offset,
            before_seq_no=before_seq_no,
            latest=latest,
        )

    async def update_read_cursor(
        self, *, chat: Chat, user_id: uuid.UUID, last_read_seq_no: int
    ) -> ChatMember:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=user_id)
        if member is None:
            raise ChatServiceError(code="FORBIDDEN", message="Нет доступа к чату", status_code=403)
        member.last_read_seq_no = max(member.last_read_seq_no, int(last_read_seq_no))
        await self.session.flush()
        return member

    async def delete_message(self, *, message: ChatMessage, actor_id: uuid.UUID) -> None:
        member = await self.repo.get_chat_member(chat_id=message.chat_id, user_id=actor_id)
        if member is None:
            raise ChatServiceError(code="FORBIDDEN", message="Нет доступа к сообщению", status_code=403)
        if member.role not in self.CHAT_ADMIN_ROLES and message.sender_id != actor_id:
            raise ChatServiceError(code="FORBIDDEN", message="Можно удалять только свои сообщения", status_code=403)
        await self.repo.delete_message(message)

    async def delete_chat(self, *, chat: Chat, actor_id: uuid.UUID) -> None:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=actor_id)
        if member is None or member.role not in self.CHAT_ADMIN_ROLES:
            raise ChatServiceError(code="FORBIDDEN", message="Недостаточно прав для удаления чата", status_code=403)
        await self.repo.delete_chat(chat)

    async def _resolve_attachments_for_message(
        self,
        *,
        chat: Chat,
        actor_id: uuid.UUID,
        attachment_ids: list[uuid.UUID],
    ) -> list[dict]:
        if not attachment_ids:
            return []

        sessions = await self.repo.list_upload_sessions_for_user_files(
            org_id=chat.org_id,
            chat_id=chat.id,
            user_id=actor_id,
            file_ids=attachment_ids,
        )
        sessions_by_file_id = {session.file_id: session for session in sessions}
        missing_session_ids = [file_id for file_id in attachment_ids if file_id not in sessions_by_file_id]
        if missing_session_ids:
            raise ChatServiceError(code="ATTACHMENT_FORBIDDEN", message="Некорректные вложения для этого чата")
        if any(session.status != "ready" for session in sessions):
            raise ChatServiceError(code="ATTACHMENT_NOT_READY", message="Некоторые вложения еще не готовы")

        files = await self.repo.list_files_for_org_ids(org_id=chat.org_id, file_ids=attachment_ids)
        files_by_id = {file.id: file for file in files}
        if len(files_by_id) != len(attachment_ids):
            raise ChatServiceError(code="ATTACHMENT_NOT_FOUND", message="Одно или несколько вложений не найдены")

        result: list[dict] = []
        for file_id in attachment_ids:
            db_file = files_by_id[file_id]
            if db_file.uploaded_by != actor_id:
                raise ChatServiceError(code="ATTACHMENT_FORBIDDEN", message="Недостаточно прав на вложение")
            if db_file.type != "chat_attachment":
                raise ChatServiceError(code="ATTACHMENT_INVALID_TYPE", message="Файл нельзя прикрепить к сообщению")
            if db_file.status not in self.CHAT_ALLOWED_ATTACHMENT_STATUSES:
                raise ChatServiceError(code="ATTACHMENT_NOT_READY", message="Вложение еще не готово")
            result.append(
                {
                    "file_id": str(db_file.id),
                    "filename": db_file.filename,
                    "original_name": db_file.original_name,
                    "content_type": db_file.content_type,
                    "size": int(db_file.size),
                    "status": str(db_file.status or "ready"),
                }
            )
        return result

    @staticmethod
    def _normalize_message_meta(*, meta: dict | None, attachments: list[dict]) -> dict | None:
        payload = dict(meta or {})
        if attachments:
            payload["attachment_ids"] = [item["file_id"] for item in attachments]
            payload["attachments"] = attachments
        else:
            payload.pop("attachment_ids", None)
            payload.pop("attachments", None)
        return payload or None

    @classmethod
    def _validate_voice_note_meta(cls, *, meta: dict | None, attachments: list[dict]) -> None:
        if not isinstance(meta, dict):
            return

        voice_note = meta.get("voice_note")
        if voice_note is None:
            return
        if not isinstance(voice_note, dict):
            raise ChatServiceError(code="VALIDATION_ERROR", message="voice_note должен быть объектом")

        duration_raw = voice_note.get("duration_ms")
        try:
            duration_ms = int(duration_raw)
        except (TypeError, ValueError) as exc:
            raise ChatServiceError(code="VALIDATION_ERROR", message="voice_note.duration_ms должен быть числом") from exc
        if duration_ms <= 0 or duration_ms > cls.VOICE_NOTE_MAX_DURATION_MS:
            raise ChatServiceError(code="VALIDATION_ERROR", message="Голосовое сообщение не должно превышать 1 минуту")

        audio_attachments = [
            item for item in attachments if str(item.get("content_type") or "").strip().lower().startswith("audio/")
        ]
        if len(audio_attachments) != 1:
            raise ChatServiceError(
                code="VALIDATION_ERROR",
                message="voice_note поддерживается только с одним аудио-вложением",
            )

        voice_file_id = str(voice_note.get("file_id") or "").strip()
        if voice_file_id and voice_file_id != str(audio_attachments[0].get("file_id") or ""):
            raise ChatServiceError(code="VALIDATION_ERROR", message="voice_note.file_id не совпадает с аудио-вложением")

    @staticmethod
    def _extract_attachment_ids(meta: dict | None) -> list[uuid.UUID]:
        if not isinstance(meta, dict):
            return []

        raw_ids = meta.get("attachment_ids")
        if raw_ids is None and isinstance(meta.get("attachments"), list):
            raw_ids = [
                item.get("file_id")
                for item in meta.get("attachments", [])
                if isinstance(item, dict) and item.get("file_id")
            ]

        if raw_ids is None:
            return []
        if not isinstance(raw_ids, list):
            raise ChatServiceError(code="VALIDATION_ERROR", message="attachment_ids должен быть списком")

        normalized: list[uuid.UUID] = []
        seen: set[uuid.UUID] = set()
        max_files = int(max(1, int(settings.CHAT_ATTACHMENT_MAX_FILES_PER_MESSAGE or 8)))
        for item in raw_ids:
            try:
                file_id = uuid.UUID(str(item))
            except (TypeError, ValueError) as exc:
                raise ChatServiceError(code="VALIDATION_ERROR", message="Некорректный attachment_id") from exc
            if file_id in seen:
                continue
            seen.add(file_id)
            normalized.append(file_id)
        if len(normalized) > max_files:
            raise ChatServiceError(
                code="VALIDATION_ERROR",
                message=f"Максимум {max_files} вложений на одно сообщение",
            )
        return normalized

    @staticmethod
    def _attachment_allowed_mime_types() -> set[str]:
        return {str(x).strip().lower() for x in (settings.CHAT_ATTACHMENT_ALLOWED_MIME_TYPES or []) if str(x).strip()}

    async def _enforce_storage_limit(self, *, org_id: uuid.UUID, incoming_size: int) -> None:
        plan = await self.files_repo.resolve_effective_plan(org_id=org_id)
        max_storage_mb = int(getattr(plan, "max_storage_mb", 0) or 0)
        if max_storage_mb <= 0:
            return
        max_storage_bytes = max_storage_mb * 1024 * 1024
        current_bytes = await self.files_repo.get_org_storage_bytes(org_id)
        if current_bytes + int(incoming_size) > max_storage_bytes:
            raise ChatServiceError(
                code="STORAGE_LIMIT_REACHED",
                message="Достигнут лимит тарифа по хранилищу.",
            )

    @staticmethod
    def _dedup_ids(items: list[uuid.UUID]) -> list[uuid.UUID]:
        result: list[uuid.UUID] = []
        seen: set[uuid.UUID] = set()
        for item in items:
            if item in seen:
                continue
            seen.add(item)
            result.append(item)
        return result
