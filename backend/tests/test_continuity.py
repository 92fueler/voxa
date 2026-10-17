import asyncio

import pytest
from conftest import FakeProvider, seed, turn

from src.context import ContextError, ContextPreviews
from src.summaries import SummaryRunner, generate_summary, summary_input, validate_summary
from src.util import encode, now_ms


async def test_auto_recent_three_bounded_unicode_fallback(store):
    ids = []
    for n in range(4):
        ids.append(
            await seed(store, started_at=now_ms() - 10000 + n * 1000, text=f"TOPIC{n} " + "中🌿" * 6000)
        )
    preview = await ContextPreviews(store).automatic()
    assert preview is not None
    assert [s["id"] for s in preview["sessions"]] == list(reversed(ids[1:]))
    assert "TOPIC0" not in preview["text"] and "�" not in preview["text"]
    assert len(preview["text"].encode()) <= 6000
    assert all(s["recentTurns"] for s in preview["sections"])
    assert "omitted" in " ".join(preview["warnings"])


async def test_context_selection_reuse_stale_expiry_and_limit(store):
    item_id = await seed(store, ready=True, text="SELECTED")
    await seed(store, ready=True, text="UNSELECTED")
    now = now_ms()
    previews = ContextPreviews(store, now=lambda: now)
    packet = await previews.preview([item_id])
    assert "UNSELECTED" not in packet["text"] and "SELECTED" in packet["text"]
    await previews.take(packet["token"])
    assert previews.uses(item_id)
    previews.release(packet["token"])
    with pytest.raises(ContextError, match="expired"):
        await previews.take(packet["token"])
    stale = await previews.preview([item_id])
    await store.run("turn", {"id": item_id, "providerSessionId": "fixture", "turn": turn(revision=2)})
    with pytest.raises(ContextError, match="changed"):
        await previews.take(stale["token"])
    assert not previews.uses(item_id)
    await SummaryRunner(store, FakeProvider()).tick()
    packet = await previews.preview([item_id])
    now += 300001
    with pytest.raises(ContextError, match="expired"):
        await previews.take(packet["token"])
    for _ in range(16):
        await previews.preview([item_id])
    with pytest.raises(ContextError) as exc:
        await previews.preview([item_id])
    assert exc.value.code == "PREVIEW_LIMIT"


async def test_no_context_from_active_empty_deleted_interrupted_or_expired_sources(store):
    item_id = await seed(store)
    await store.run(
        "turn",
        {"id": item_id, "providerSessionId": "fixture", "turn": turn(revision=2, status="interrupted")},
    )
    await store.run("create", {"id": "active", "startedAt": now_ms()})
    await store.run("create", {"id": "empty", "startedAt": now_ms()})
    await store.run("finish", {"id": "empty", "endedAt": now_ms(), "incomplete": False})
    assert await ContextPreviews(store).automatic() is None


async def test_history_failure_is_not_silently_ignored(system, monkeypatch):
    app, client, provider = system

    async def fail(*args):
        raise RuntimeError("PRIVATE")

    monkeypatch.setattr(app.state.previews.store, "run", fail)
    response = await client.post("/api/session", json={"save": True})
    assert response.json()["code"] == "HISTORY_UNAVAILABLE"
    assert not provider.created and "PRIVATE" not in response.text


async def test_summary_excludes_uncertain_text_and_bounds_long_input(store):
    item_id = await seed(store)
    source = await store.run("get", {"id": item_id})
    source["incomplete"] = 1
    source["turns"] += [
        turn("interrupted", status="interrupted", text="UNHEARD"),
        turn("unknown", orderKnown=False, text="UNORDERED"),
    ]
    chunks, warnings, allowed = summary_input(source)
    assert "UNHEARD" not in encode(chunks) and "UNORDERED" not in encode(chunks)
    assert len(warnings) == 2 and allowed == {"u"}
    source["turns"] = [
        turn(f"u{n}", previousItemId=f"u{n - 1}" if n else None, text="中🌿" * 6000) for n in range(70)
    ]
    chunks, warnings, _ = summary_input(source)
    assert len(chunks) == 6 and "latest six sections" in " ".join(warnings)
    assert all(len(encode(c).encode()) <= 24000 and "�" not in encode(c) for c in chunks)


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "x" * 81},
        {"title": "bad\nline"},
        {"titleSourceTurnIds": ["missing"]},
        {"titleSourceTurnIds": []},
        {"points": [{"kind": "fact", "text": "invented", "sourceTurnIds": ["missing"]}]},
        {"extra": 1},
    ],
)
def test_reject_ungrounded_summary(changes):
    with pytest.raises(ValueError):
        validate_summary({"title": "主题", "titleSourceTurnIds": ["u"], "points": [], **changes}, {"u"})


async def test_chunk_merge_reuse_legacy_backfill_and_single_inflight(store):
    item_id = await seed(store, text="中" * 10000)
    provider = FakeProvider()
    runner = SummaryRunner(store, provider)
    await runner.tick()
    assert len(provider.summary_calls) == 3
    assert "sections" in provider.summary_calls[-1]
    source = await store.run("get", {"id": item_id})
    assert source["title"] == "合成测试" and source["summary"]["value"]["model"] == "fixture-summary"
    await store.run("summary-request", {"id": item_id})
    await runner.tick()
    assert len(provider.summary_calls) == 3
    provider.summary_wait = asyncio.Event()
    await store.run("turn", {"id": item_id, "providerSessionId": "fixture", "turn": turn(revision=2)})
    pending = asyncio.create_task(runner.tick())
    while len(provider.summary_calls) == 3:
        await asyncio.sleep(0.001)
    await runner.tick()
    assert len(provider.summary_calls) == 4
    provider.summary_wait.set()
    await pending


async def test_slow_summary_does_not_delay_voice(system):
    app, client, provider = system
    await seed(app.state.store)
    provider.summary_wait = asyncio.Event()
    pending = asyncio.create_task(app.state.summaries.tick())
    try:
        while not provider.summary_calls:
            await asyncio.sleep(0.001)
        async with asyncio.timeout(0.5):
            response = await client.post("/api/session", json={"save": True})
        assert response.status_code == 200 and response.json()["context"]
    finally:
        provider.summary_wait.set()
        await pending


async def test_failed_generation_is_bounded_and_retryable(store, monkeypatch):
    item_id = await seed(store)
    provider = FakeProvider()

    async def invalid(*args):
        return {"title": "Wrong", "titleSourceTurnIds": ["missing"], "points": []}

    monkeypatch.setattr(provider, "summarize", invalid)
    with pytest.raises(ValueError):
        await generate_summary(await store.run("get", {"id": item_id}), provider)
    await SummaryRunner(store, provider).tick()
    source = await store.run("get", {"id": item_id})
    assert source["summary"]["status"] == "pending" and source["summary"]["value"] is None
