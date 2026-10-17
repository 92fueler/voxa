"""Application ports. Vendor URLs, credentials, schemas and wire events belong in adapters."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol


class ProviderError(Exception):
    def __init__(self, code="PROVIDER_UNAVAILABLE", status=502):
        self.code, self.status = code, status
        super().__init__(code)


@dataclass(frozen=True)
class VoiceCredential:
    value: str
    expires_at: float


@dataclass(frozen=True)
class CallAnswer:
    sdp: str
    call_id: str | None


@dataclass
class Observation:
    turns: list[dict]
    issue: str | None = None


class TranscriptObserver(Protocol):
    incomplete: bool

    @property
    def issues(self) -> list[str]: ...
    def events(self) -> AsyncIterator[Observation]: ...
    def finish(self) -> list[dict]: ...


class VoiceProvider(Protocol):
    name: str
    model: str
    configured: bool
    wire_protocol: str

    async def create_session(self, save: bool, instructions: str) -> VoiceCredential: ...
    async def connect_call(self, credential: VoiceCredential, sdp: str) -> CallAnswer: ...
    def observer(self, call_id: str, ignored_items: list[str]) -> TranscriptObserver: ...


class SummaryProvider(Protocol):
    name: str
    summary_model: str
    configured: bool

    async def summarize(self, instructions: str, schema: dict, evidence: object) -> object: ...
