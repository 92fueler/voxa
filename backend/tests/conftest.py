import asyncio
import uuid

import httpx
import pytest

from src.app import create_app
from src.config import Config
from src.providers.base import CallAnswer, Observation, VoiceCredential
from src.providers.openai_transcript import Transcript
from src.store import ConversationStore
from src.util import now_ms


class FakeObserver(Transcript):
    def __init__(self, ignored_items):
        super().__init__(ignored_items=ignored_items)
        self.queue = asyncio.Queue()
        self.connections = 0
        self.closed = 0

    async def events(self):
        self.connections += 1
        try:
            yield Observation([])
            while True:
                event = await self.queue.get()
                if event is None:
                    return
                if isinstance(event, Exception):
                    raise event
                yield self.observation(event)
        finally:
            self.closed += 1


class FakeProvider:
    name = "fixture-vendor"
    model = "fixture-voice"
    summary_model = "fixture-summary"
    wire_protocol = "openai-realtime-v1"
    configured = True

    def __init__(self):
        self.created = []
        self.observers = []
        self.summary_calls = []
        self.create_error = None
        self.call_id = "fixture-call"
        self.summary_wait = None

    async def create_session(self, save, instructions, microphone="laptop"):
        self.created.append((save, instructions, microphone))
        if self.create_error:
            raise self.create_error
        return VoiceCredential("ek_fixture", now_ms() / 1000 + 60)

    async def connect_call(self, credential, sdp):
        return CallAnswer("answer", self.call_id)

    def observer(self, call_id, ignored_items):
        observer = FakeObserver(ignored_items)
        self.observers.append(observer)
        return observer

    async def summarize(self, instructions, schema, evidence):
        self.summary_calls.append(evidence)
        if self.summary_wait:
            await self.summary_wait.wait()
        refs = list(
            dict.fromkeys(
                i
                for p in (evidence if isinstance(evidence, list) else evidence["sections"])
                for i in p.get("sourceTurnIds", p.get("titleSourceTurnIds", []))
            )
        )
        return {
            "title": "合成测试",
            "titleSourceTurnIds": refs[:1],
            "points": [{"kind": "topic", "text": "Synthetic topic", "sourceTurnIds": refs[:1]}],
        }


def turn(item_id="u", **kwargs):
    return {
        "itemId": item_id,
        "previousItemId": None,
        "orderKnown": True,
        "speaker": "user",
        "text": "Synthetic 你好",
        "status": "completed",
        "revision": 1,
        "createdAt": 1,
        **kwargs,
    }


async def seed(store, *, item_id=None, started_at=None, text="Synthetic 你好", ready=False):
    item_id = item_id or str(uuid.uuid4())
    await store.run("create", {"id": item_id, "startedAt": started_at or now_ms()})
    await store.run("turn", {"id": item_id, "providerSessionId": "fixture", "turn": turn(text=text)})
    await store.run("finish", {"id": item_id, "endedAt": now_ms(), "incomplete": False})
    if ready:
        c = await store.run("summary-claim", {"claimToken": "seed", "now": now_ms()})
        await store.run(
            "summary-result",
            {
                "id": c["id"],
                "revision": c["revision"],
                "claimToken": "seed",
                "summary": {
                    "title": "Synthetic title",
                    "titleSourceTurnIds": ["u"],
                    "points": [],
                    "warnings": [],
                    "model": "fixture",
                    "sourceRevision": c["revision"],
                    "createdAt": now_ms(),
                },
            },
        )
    return item_id


@pytest.fixture
async def store(tmp_path):
    store = ConversationStore(tmp_path / "archive.sqlite")
    yield store
    await store.close()


@pytest.fixture
async def system(store):
    provider = FakeProvider()
    app = create_app(
        Config(),
        store=store,
        voice_provider=provider,
        summary_provider=provider,
        capture_options={"drain_seconds": 0.06, "cleanup_seconds": 1, "reconnect_seconds": 0.01},
    )
    # Explicit lifespan keeps cleanup realistic; stop automatic job polling so fixtures control it.
    async with app.router.lifespan_context(app):
        await app.state.summaries.close()
        app.state.summaries.stopped = False
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:4318"
        ) as client:
            yield app, client, provider
