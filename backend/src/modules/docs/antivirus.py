"""Антивирусные адаптеры для модуля Docs."""
# ruff: noqa: TC003

from __future__ import annotations

import socket
import struct
from collections.abc import Iterable
from dataclasses import dataclass

from src.config import settings


@dataclass(slots=True)
class AntivirusScanResult:
    """Результат AV-сканирования."""

    result: str
    threat_name: str | None = None
    details: str | None = None

    @property
    def is_clean(self) -> bool:
        """Признак безопасного файла."""
        return self.result == "clean"


class AntivirusProvider:
    """Базовый интерфейс антивирусного провайдера."""

    def scan_stream(self, chunks: Iterable[bytes]) -> AntivirusScanResult:
        """Проверить входящий поток байтов и вернуть verdict."""
        raise NotImplementedError


class MockCleanAntivirusProvider(AntivirusProvider):
    """Тестовый провайдер: всегда чисто."""

    def scan_stream(self, chunks: Iterable[bytes]) -> AntivirusScanResult:
        for _ in chunks:
            pass
        return AntivirusScanResult(result="clean")


class ClamAVAntivirusProvider(AntivirusProvider):
    """Провайдер ClamAV по протоколу INSTREAM."""

    def __init__(self, *, host: str, port: int, timeout_s: float, chunk_size_kb: int):
        self.host = host
        self.port = int(port)
        self.timeout_s = float(timeout_s)
        self.chunk_size = max(8 * 1024, int(chunk_size_kb) * 1024)

    def scan_stream(self, chunks: Iterable[bytes]) -> AntivirusScanResult:
        try:
            with socket.create_connection((self.host, self.port), timeout=self.timeout_s) as sock:
                sock.settimeout(self.timeout_s)
                sock.sendall(b"zINSTREAM\0")

                for chunk in chunks:
                    if not chunk:
                        continue
                    offset = 0
                    raw = bytes(chunk)
                    while offset < len(raw):
                        part = raw[offset : offset + self.chunk_size]
                        sock.sendall(struct.pack("!I", len(part)))
                        sock.sendall(part)
                        offset += len(part)

                sock.sendall(struct.pack("!I", 0))
                response = self._read_response(sock)
        except (OSError, ValueError) as exc:
            return AntivirusScanResult(result="error", details=f"clamav_unavailable: {exc}")

        if "FOUND" in response:
            threat = response.split("FOUND", 1)[0].split(":", 1)[-1].strip() or "unknown"
            return AntivirusScanResult(result="infected", threat_name=threat, details=response)
        if response.endswith("OK"):
            return AntivirusScanResult(result="clean", details=response)
        return AntivirusScanResult(result="error", details=response)

    @staticmethod
    def _read_response(sock: socket.socket) -> str:
        chunks: list[bytes] = []
        while True:
            part = sock.recv(4096)
            if not part:
                break
            chunks.append(part)
            if b"\n" in part:
                break
        return b"".join(chunks).decode("utf-8", errors="replace").strip()


def build_antivirus_provider() -> AntivirusProvider:
    """Построить AV-провайдер на основе runtime-конфига."""
    mode = str(getattr(settings, "DOCS_AV_MODE", "mock_clean") or "mock_clean").strip().lower()
    if mode == "clamav":
        return ClamAVAntivirusProvider(
            host=settings.DOCS_CLAMAV_HOST,
            port=settings.DOCS_CLAMAV_PORT,
            timeout_s=settings.DOCS_CLAMAV_TIMEOUT_S,
            chunk_size_kb=settings.DOCS_SCAN_CHUNK_SIZE_KB,
        )
    return MockCleanAntivirusProvider()
