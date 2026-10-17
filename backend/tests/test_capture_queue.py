import asyncio

import pytest
from conftest import FakeProvider

from src.capture import Captures
from src.providers.base import VoiceCredential
from src.providers.openai_transcript import Transcript
from src.save_queue import SaveQueue
from src.util import now_ms


async def test_queue_coalescing_order_retry_and_overflow():
    calls, failed = [], False

    async def write(op, value):
        nonlocal failed
        calls.append((op, value))
        if not failed:
            failed = True
            raise RuntimeError("lock")

    queue = SaveQueue(write, retry_seconds=0.001)
    queue.enqueue("create", "create", {})
    queue.enqueue("turn", "turn", {"revision": 1})
    queue.enqueue("turn", "turn", {"revision": 2})
    await queue.flush()
    assert [op for op, _ in calls] == ["create", "create", "turn"]
    assert calls[-1][1] == {"revision": 2} and queue.state == "saved"
    queue.dispose()
    gate = asyncio.Event()

    async def stalled(*args):
        await gate.wait()

    queue = SaveQueue(stalled, max_tasks=2, max_bytes=1000)
    queue.enqueue("one", "turn", {})
    queue.enqueue("two", "turn", {})
    queue.enqueue("three", "turn", {})
    assert queue.pending == 2 and queue.state == "incomplete"
    queue.dispose()
    await asyncio.sleep(0)


async def test_queue_abandons_persistent_failures_without_orphan_writes():
    calls = []

    async def write(op, value):
        calls.append(op)
        raise RuntimeError("disk")

    queue = SaveQueue(write, retry_seconds=0.001, max_age_ms=10)
    queue.enqueue("create", "create", {})
    queue.enqueue("turn", "turn", {})
    await queue.flush()
    assert queue.state == "incomplete" and queue.pending == 0
    assert set(calls) == {"create"}
    queue.dispose()


async def test_observer_reconnect_is_bounded_and_does_not_claim_replay(store):
    provider = FakeProvider()
    captures = Captures(store, provider, 2700, reconnect_seconds=0.001)
    data = captures.register(VoiceCredential("secret", now_ms() / 1000 + 60))
    captures.take_credential(data["handle"])
    captures.attach(data["handle"], "owned")
    observer = provider.observers[0]
    try:
        for attempt in range(3):
            while observer.connections <= attempt:
                await asyncio.sleep(0.001)
            await observer.queue.put(RuntimeError("PRIVATE"))
        await asyncio.sleep(0.02)
        assert observer.connections == 3
        status = captures.status(data["handle"])
        assert status is not None
        assert status["state"] == "incomplete"
    finally:
        await captures.close()


@pytest.mark.parametrize(
    "code,event_id,expected",
    [
        ("response_cancel_not_active", "any", None),
        ("input_audio_buffer_commit_empty", "voxa_end_commit", None),
        ("input_audio_buffer_commit_empty", "other", "provider_error"),
        ("unexpected", "other", "provider_error"),
    ],
)
def test_cleanup_error_classification(code, event_id, expected):
    assert (
        Transcript()
        .observation({"type": "error", "error": {"code": code, "event_id": event_id, "message": "PRIVATE"}})
        .issue
        == expected
    )


async def test_missing_observer_does_not_break_call_and_marks_internal_capture(system):
    app, client, provider = system
    provider.call_id = None
    handle = (await client.post("/api/session", json={"save": True})).json()["handle"]
    assert (await client.post("/api/call", json={"handle": handle, "sdp": "offer"})).status_code == 200
    assert (await client.post("/api/capture/status", json={"handle": handle})).json()["state"] == "incomplete"
    assert not provider.observers


async def test_shutdown_flushes_received_turns_and_finalization(store):
    provider = FakeProvider()
    captures = Captures(store, provider, 2700)
    data = captures.register(VoiceCredential("secret", now_ms() / 1000 + 60))
    captures.take_credential(data["handle"])
    captures.attach(data["handle"], "owned")
    observer = provider.observers[0]
    await observer.queue.put(
        {"type": "input_audio_buffer.committed", "item_id": "u", "previous_item_id": None}
    )
    await observer.queue.put(
        {
            "type": "conversation.item.input_audio_transcription.completed",
            "item_id": "u",
            "transcript": "Shutdown synthetic",
        }
    )
    await asyncio.sleep(0.01)
    await captures.close()
    source = await store.run("get", {"id": data["conversationId"]})
    assert source["endedAt"] and source["turns"][0]["text"] == "Shutdown synthetic"


async def test_storage_failure_does_not_block_saved_signaling(system, monkeypatch):
    app, client, provider = system
    original = app.state.store.run

    async def failing(op, payload=None):
        if op in ("list", "get"):
            return await original(op, payload)
        raise RuntimeError("PRIVATE")

    monkeypatch.setattr(app.state.store, "run", failing)
    handle = (await client.post("/api/session", json={"save": True})).json()["handle"]
    assert (await client.post("/api/call", json={"handle": handle, "sdp": "offer"})).status_code == 200
    assert (await client.post("/api/capture/status", json={"handle": handle})).json()["state"] == "delayed"
    # Avoid spending the shutdown flush budget retrying an intentionally dead store.
    for capture in app.state.captures.entries.values():
        capture.queue.dispose()
