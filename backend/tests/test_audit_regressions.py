import asyncio

from conftest import FakeProvider, turn

from src.capture import Captures
from src.providers.base import VoiceCredential
from src.summaries import summary_input
from src.util import encode, now_ms, order_turns


def test_long_reverse_arrival_chain_has_no_recursion_limit():
    turns = [turn(str(n), previousItemId=str(n - 1) if n else None, createdAt=2000 - n) for n in range(2000)]
    ordered = order_turns(turns)
    assert [t["itemId"] for t in ordered] == [str(n) for n in range(2000)]
    assert all(t["orderKnown"] for t in ordered)
    assert turns[0]["createdAt"] == 2000


def test_cycle_members_are_all_excluded_from_known_order():
    turns = [turn("a", previousItemId="b"), turn("b", previousItemId="c"), turn("c", previousItemId="a")]
    ordered = order_turns(turns)
    assert {t["itemId"] for t in ordered} == {"a", "b", "c"}
    assert all(not t["orderKnown"] for t in ordered)
    assert all(t["orderKnown"] for t in turns)  # Do not rewrite stored evidence.


def test_serialized_summary_chunks_handle_escaped_control_text():
    chunks, _, _ = summary_input({"turns": [turn(text="\x00" * 6000)], "incomplete": 0})
    assert all(chunk and len(encode(chunk).encode()) <= 24000 for chunk in chunks)
    assert "".join(p["text"] for c in chunks for p in c) == "\x00" * 6000


async def test_capture_shutdown_flushes_queues_concurrently(store, monkeypatch):
    provider = FakeProvider()
    captures = Captures(store, provider, 2700)
    release = asyncio.Event()
    started = set()
    for n in range(2):
        data = captures.register(VoiceCredential("synthetic", now_ms() / 1000 + 60))

        async def flush(index=n):
            started.add(index)
            await release.wait()

        monkeypatch.setattr(captures.entries[data["handle"]].queue, "flush", flush)
    closing = asyncio.create_task(captures.close())
    try:
        async with asyncio.timeout(0.2):
            while len(started) != 2:
                await asyncio.sleep(0.001)
    finally:
        release.set()
        await closing


def test_installed_layout_uses_launch_directory(tmp_path):
    from src.config import project_root

    installed_module = tmp_path / "venv/lib/python3.13/site-packages/src/config.py"
    backend = tmp_path / "project/backend"
    backend.mkdir(parents=True)
    assert project_root(installed_module, backend) == backend
    source_module = backend / "src/config.py"
    (backend / "pyproject.toml").write_text('[project]\nname="voxa-backend"\n')
    assert project_root(source_module, tmp_path) == backend


async def test_merge_request_stays_within_the_input_budget(monkeypatch):
    from src.summaries import generate_summary

    provider = FakeProvider()
    requests = []

    async def summarize(instructions, schema, evidence):
        requests.append(evidence)
        if isinstance(evidence, list):
            refs = evidence[0]["sourceTurnIds"]
            return {
                "title": "合成主题",
                "titleSourceTurnIds": refs,
                "points": [
                    {"kind": "topic", "text": "中" * 235 + str(n), "sourceTurnIds": refs} for n in range(8)
                ],
            }
        refs = evidence["sections"][0]["titleSourceTurnIds"]
        return {"title": "合成主题", "titleSourceTurnIds": refs, "points": []}

    monkeypatch.setattr(provider, "summarize", summarize)
    conversation = {
        "revision": 1,
        "turns": [
            turn(str(n), text="中" * 6000, previousItemId=str(n - 1) if n else None) for n in range(30)
        ],
    }
    result = await generate_summary(conversation, provider)
    assert len(requests) <= 7
    assert all(len(encode(request).encode()) <= 24000 for request in requests)
    assert any("omitted" in warning for warning in result["warnings"])


async def test_lifespan_closes_storage_and_http_even_if_capture_cleanup_fails(store, monkeypatch):
    import httpx
    import pytest

    from src.app import create_app
    from src.config import Config

    provider = FakeProvider()
    client = httpx.AsyncClient()
    app = create_app(Config(), store=store, client=client, voice_provider=provider, summary_provider=provider)

    async def fail():
        raise RuntimeError("Synthetic cleanup failure")

    monkeypatch.setattr(app.state.captures, "close", fail)
    with pytest.raises(RuntimeError, match="Synthetic cleanup failure"):
        async with app.router.lifespan_context(app):
            pass
    assert store.closed and client.is_closed


async def test_expired_setup_credential_never_reaches_call_provider(store, monkeypatch):
    provider = FakeProvider()
    captures = Captures(store, provider, 2700)
    clock = now_ms()
    data = captures.register(VoiceCredential("synthetic", clock / 1000 + 60))
    monkeypatch.setattr("src.capture.now_ms", lambda: clock + 61000)
    try:
        assert captures.take_credential(data["handle"]) is None
        assert captures.entries[data["handle"]].ending
        assert not provider.observers
    finally:
        await captures.close()
