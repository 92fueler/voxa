import asyncio
import uuid

import httpx
import pytest
from conftest import seed

from src.app import create_app
from src.config import Config
from src.providers.base import ProviderError


async def test_health_is_local_private_and_provider_independent(system):
    app, client, provider = system
    response = await client.get("/api/health")
    assert response.json() == {
        "status": "ok",
        "realtimeConfigured": True,
        "model": "fixture-voice",
        "sessionMaxSeconds": 2700,
    }
    assert response.headers["cache-control"] == "no-store"
    assert not provider.created
    for headers in ({"host": "evil.test:4318"}, {"origin": "https://evil.test"}, {"origin": "null"}):
        response = await client.post("/api/session", json={}, headers=headers)
        assert response.status_code == 403
        assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "body",
    [{"model": "other"}, {"save": "yes"}, {"save": 1}, {"contextToken": "bad"}, {"apiKey": "PRIVATE_KEY"}],
)
async def test_rejects_untrusted_session_options(system, body):
    _, client, provider = system
    response = await client.post("/api/session", json=body)
    assert response.status_code == 400
    assert "PRIVATE" not in response.text
    assert not provider.created


async def test_request_bounds_and_invalid_json(system):
    _, client, _ = system
    assert (await client.post("/api/session", content=b"x" * 1025)).status_code == 413
    assert (
        await client.post("/api/session", content="{bad", headers={"Content-Type": "application/json"})
    ).status_code == 400
    assert (await client.get("/api/conversations/not-uuid")).status_code == 400
    assert (await client.post("/api/call", json={"handle": "a" * 64, "sdp": "x" * 100001})).status_code == 400


async def test_missing_key_never_calls_provider(system):
    _, client, provider = system
    provider.configured = False
    response = await client.post("/api/session", json={})
    assert response.status_code == 503
    assert response.json()["code"] == "API_KEY_REQUIRED"
    assert not provider.created


@pytest.mark.parametrize(
    "exc,code,status",
    [
        (ProviderError("PROVIDER_REJECTED"), "PROVIDER_REJECTED", 502),
        (ProviderError("INVALID_CREDENTIAL"), "INVALID_CREDENTIAL", 502),
        (ProviderError("PROVIDER_TIMEOUT", 504), "PROVIDER_TIMEOUT", 504),
        (RuntimeError("PRIVATE"), "PROVIDER_UNAVAILABLE", 502),
    ],
)
async def test_sanitized_provider_failures(system, exc, code, status):
    _, client, provider = system
    provider.create_error = exc
    response = await client.post("/api/session", json={})
    assert response.status_code == status
    assert response.json()["code"] == code
    assert "PRIVATE" not in response.text


async def test_deadline_releases_context_reservation(store, monkeypatch):
    from conftest import FakeProvider

    provider = FakeProvider()

    async def stall(*args):
        await asyncio.sleep(10)

    monkeypatch.setattr(provider, "create_session", stall)
    app = create_app(
        Config(), store=store, voice_provider=provider, summary_provider=provider, setup_timeout=0.01
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:4318"
        ) as client:
            response = await client.post("/api/session", json={})
            assert response.status_code == 504
            assert not app.state.previews.reservations


async def test_saved_handle_single_use_and_late_final_turn(system):
    app, client, provider = system
    response = await client.post("/api/session", json={"save": True})
    assert response.status_code == 200
    assert "ek_" not in response.text
    data = response.json()
    handle, item_id = data["handle"], data["conversationId"]
    assert (await client.post("/api/call", json={"handle": handle, "sdp": "offer"})).text == "answer"
    assert (await client.post("/api/call", json={"handle": handle, "sdp": "offer"})).status_code == 404
    assert (
        await client.post("/api/call", json={"handle": handle, "sdp": "offer", "callId": "foreign"})
    ).status_code == 400
    await asyncio.sleep(0.005)
    assert (await client.delete(f"/api/conversations/{item_id}")).status_code == 409
    await client.post("/api/capture/end", json={"handle": handle})
    await client.post("/api/capture/end", json={"handle": handle})
    assert (await client.post("/api/capture/status", json={"handle": handle})).json()["state"] == "finalizing"
    observer = provider.observers[0]
    await observer.queue.put(
        {"type": "input_audio_buffer.committed", "item_id": "u", "previous_item_id": None}
    )
    await observer.queue.put(
        {
            "type": "conversation.item.input_audio_transcription.completed",
            "item_id": "u",
            "transcript": "Final synthetic words 你好",
        }
    )
    await asyncio.sleep(0.1)
    status = (await client.post("/api/capture/status", json={"handle": handle})).json()
    assert status["ended"] and status["pending"] == 0 and status["state"] == "saved"
    source = (await client.get(f"/api/conversations/{item_id}")).json()
    assert source["turns"][0]["text"] == "Final synthetic words 你好"
    assert source["summary"]["status"] == "pending"
    assert observer.closed == 1
    assert (await client.delete(f"/api/conversations/{item_id}")).status_code == 200
    assert (await client.get(f"/api/conversations/{item_id}")).status_code == 404


async def test_no_save_has_no_archive_observer_or_summary(system):
    app, client, provider = system
    response = await client.post("/api/session", json={"save": False})
    assert response.json()["value"] == "ek_fixture"
    assert not provider.created[0][0]
    assert not provider.observers
    assert await app.state.store.run("list") == []


async def test_automatic_history_in_unsaved_session_protects_sources(system):
    app, client, provider = system
    source_id = await seed(app.state.store)
    response = (await client.post("/api/session", json={"save": False})).json()
    assert "Synthetic" in response["context"]["text"]
    assert (await client.delete(f"/api/conversations/{source_id}")).status_code == 409
    await client.post("/api/call", json={"handle": response["handle"], "sdp": "offer"})
    assert not provider.observers
    assert len(await app.state.store.run("list")) == 1
    await client.post("/api/capture/end", json={"handle": response["handle"]})
    assert (await client.delete(f"/api/conversations/{source_id}")).status_code == 200


async def test_category_crud_summary_preservation_and_export(system):
    app, client, provider = system
    item_id = await seed(app.state.store, ready=True)
    before = (await client.get(f"/api/conversations/{item_id}")).json()
    category = await client.post("/api/categories", json={"name": "  Practice  "})
    assert category.status_code == 201
    category = category.json()
    assert category["name"] == "Practice"
    assert (await client.post("/api/categories", json={"name": "practice"})).status_code == 409
    assert (
        await client.patch(f"/api/conversations/{item_id}/category", json={"categoryId": category["id"]})
    ).status_code == 200
    assert (await client.patch(f"/api/categories/{category['id']}", json={"name": "学习"})).status_code == 200
    assert (await client.get("/api/categories")).json() == [{**category, "name": "学习"}]
    exported = (await client.get(f"/api/conversations/{item_id}/export")).json()
    assert (
        exported["schemaVersion"] == 1 and exported["conversation"]["summary"]["title"] == "Synthetic title"
    )
    assert (await client.delete(f"/api/categories/{category['id']}")).status_code == 200
    after = (await client.get(f"/api/conversations/{item_id}")).json()
    assert after == before
    assert not provider.summary_calls
    assert (
        await client.patch(f"/api/conversations/{item_id}/category", json={"categoryId": str(uuid.uuid4())})
    ).status_code == 409


@pytest.mark.parametrize("name", ["", "   ", "x" * 61])
async def test_category_validation(system, name):
    _, client, _ = system
    assert (await client.post("/api/categories", json={"name": name})).status_code == 400


async def test_explicit_preview_and_summary_endpoints(system):
    app, client, _ = system
    item_id = await seed(app.state.store)
    assert (await client.post("/api/context/preview", json={"ids": [item_id, item_id]})).status_code == 400
    pending = await client.post("/api/context/preview", json={"ids": [item_id]})
    assert pending.json()["code"] == "SUMMARY_PENDING"
    assert (await client.post(f"/api/conversations/{item_id}/summary?other=true")).status_code == 400
    assert (await client.post(f"/api/conversations/{item_id}/summary?requireTitle=true")).status_code == 202
    await app.state.summaries.tick()
    preview = await client.post("/api/context/preview", json={"ids": [item_id]})
    assert preview.status_code == 200
    session = await client.post("/api/session", json={"contextToken": preview.json()["token"]})
    assert session.status_code == 200
    assert (await client.post("/api/session", json={"contextToken": preview.json()["token"]})).json()[
        "code"
    ] == "PREVIEW_EXPIRED"
