import json
import time
import uuid

import httpx
import pytest

from src.config import Config
from src.integrations.brainshuffle import BrainShuffleClient
from src.providers import create_provider
from src.providers.base import ProviderError, VoiceCredential
from src.providers.openai import OpenAIProvider


@pytest.mark.parametrize("save", [False, True])
async def test_openai_voice_contract(save):
    seen = []

    async def handler(request):
        seen.append(request)
        if request.url.path.endswith("client_secrets"):
            return httpx.Response(
                200,
                json={
                    "value": "ek_synthetic",
                    "expires_at": time.time() + 60,
                    "session": {"private": "PRIVATE"},
                },
            )
        return httpx.Response(201, text="answer", headers={"location": "/v1/realtime/calls/rtc_owned"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = OpenAIProvider(Config(api_key="permanent-fixture"), client)
        credential = await provider.create_session(save, "instructions")
        answer = await provider.connect_call(credential, "offer")
        assert answer.call_id == "rtc_owned" and answer.sdp == "answer"
        body = json.loads(seen[0].content)
        assert body["expires_after"]["seconds"] == 60
        assert body["session"]["output_modalities"] == ["audio"]
        assert body["session"]["audio"]["output"]["voice"] == "marin"
        assert body["session"]["audio"]["input"]["turn_detection"] == {
            "type": "semantic_vad",
            "eagerness": "low",
            "create_response": True,
            "interrupt_response": True,
        }
        assert ("transcription" in body["session"]["audio"]["input"]) == save
        assert body["session"]["tracing"] is None
        assert seen[0].headers["authorization"] == "Bearer permanent-fixture"
        assert seen[1].headers["authorization"] == "Bearer ek_synthetic"
        assert seen[1].headers["content-type"] == "application/sdp"


@pytest.mark.parametrize(
    "location",
    [
        "https://evil.test/v1/realtime/calls/rtc_owned",
        "/other/rtc_owned",
        "/v1/realtime/calls/rtc_owned?steal=1",
        "http://api.openai.com/v1/realtime/calls/rtc_owned",
        "",
        "https://user@api.openai.com/v1/realtime/calls/rtc_owned",
    ],
)
async def test_provider_never_observes_foreign_call(location):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda r: httpx.Response(201, text="answer", headers={"location": location})
        )
    ) as client:
        answer = await OpenAIProvider(Config(), client).connect_call(
            VoiceCredential("ek_test", time.time() + 60), "offer"
        )
        assert answer.sdp == "answer" and answer.call_id is None


@pytest.mark.parametrize(
    "payload",
    [
        None,
        {},
        {"value": "wrong", "expires_at": 9999999999},
        {"value": "ek_test", "expires_at": 1},
        {"value": "ek_test", "expires_at": True},
    ],
)
async def test_invalid_provider_credentials(payload):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=payload))
    ) as client:
        with pytest.raises(ProviderError) as exc:
            await OpenAIProvider(Config(), client).create_session(False, "instructions")
        assert exc.value.code == "INVALID_CREDENTIAL"


@pytest.mark.parametrize("status", [401, 429, 500])
async def test_provider_errors_do_not_expose_private_bodies(status):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(status, text="PRIVATE"))
    ) as client:
        with pytest.raises(ProviderError) as exc:
            await OpenAIProvider(Config(), client).create_session(False, "instructions")
        assert exc.value.code == "PROVIDER_REJECTED" and "PRIVATE" not in str(exc.value)


@pytest.mark.parametrize(
    "exception,code",
    [
        (httpx.ReadTimeout("PRIVATE"), "PROVIDER_TIMEOUT"),
        (httpx.ConnectError("PRIVATE"), "PROVIDER_UNAVAILABLE"),
    ],
)
async def test_provider_network_failures(exception, code):
    def handler(request):
        raise exception

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ProviderError) as exc:
            await OpenAIProvider(Config(), client).create_session(False, "instructions")
        assert exc.value.code == code


@pytest.mark.parametrize(
    "response",
    [
        {"status": "incomplete", "output": []},
        {
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "No"}]}],
        },
    ],
)
async def test_summary_refusal_and_incomplete_not_accepted(response):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=response))
    ) as client:
        with pytest.raises(ProviderError):
            await OpenAIProvider(Config(), client).summarize("instructions", {}, [])


async def test_structured_summary_preserves_settings():
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {"type": "message", "content": [{"type": "output_text", "text": '{"points":[]}'}]}
                ],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await OpenAIProvider(Config(), client).summarize(
            "instruction", {"type": "object"}, [{"text": "合成"}]
        )
        assert result == {"points": []}
        assert seen[0]["model"] == "gpt-5.6-terra" and seen[0]["store"] is False
        assert seen[0]["reasoning"] == {"effort": "none"}
        assert seen[0]["input"] == '[{"text":"合成"}]'
        assert seen[0]["text"]["format"]["strict"] is True


@pytest.mark.parametrize(
    "settings",
    [
        {"session_max_seconds": 29},
        {"session_max_seconds": 2701},
        {"session_max_seconds": 1.5},
        {"model": "unknown"},
        {"brainshuffle_url": "https://example.com"},
        {"brainshuffle_url": "http://127.0.0.1:8000/arbitrary"},
        {"brainshuffle_url": "http://user@localhost:8000"},
    ],
)
def test_config_rejects_unsupported_settings(settings):
    with pytest.raises(ValueError):
        Config(**settings)


def test_unknown_provider_fails_explicitly():
    with pytest.raises(ValueError, match="Unknown provider"):
        create_provider("unimplemented", Config(), None)


async def test_brainshuffle_matches_real_problem_schema_omits_solution_and_encodes_id():
    item_id, category_id = uuid.uuid4(), uuid.uuid4()
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(
            200,
            json={
                "id": str(item_id),
                "category_id": str(category_id),
                "title": "Synthetic recall",
                "prompt": "Explain caching",
                "notes": "HIDDEN_SOLUTION",
                "tags": ["cache"],
                "companies": [],
                "review_count": 2,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        problem = await BrainShuffleClient("http://127.0.0.1:8000", client).problem(item_id)
        assert problem.title == "Synthetic recall"
        assert "HIDDEN" not in problem.model_dump_json()
        assert seen == [f"http://127.0.0.1:8000/api/problems/{item_id}"]


async def test_brainshuffle_rejects_redirect_wrong_identity_and_large_payload():
    item_id = uuid.uuid4()
    for response in [
        httpx.Response(302, headers={"location": "http://evil.test"}),
        httpx.Response(
            200,
            json={
                "id": str(uuid.uuid4()),
                "category_id": str(uuid.uuid4()),
                "title": "Wrong",
                "prompt": "Wrong",
            },
        ),
        httpx.Response(200, content=b"x" * 256001),
    ]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: response)) as client:
            with pytest.raises((httpx.HTTPError, ValueError)):
                await BrainShuffleClient("http://127.0.0.1:8000", client).problem(item_id)


async def test_websocket_adapter_normalizes_events_and_bounds_transport(monkeypatch):
    from src.providers.openai import OpenAIObserver

    options = []

    class Socket:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def __aiter__(self):
            for event in [
                "not-json",
                json.dumps(
                    {"type": "input_audio_buffer.committed", "item_id": "u", "previous_item_id": None}
                ),
                json.dumps(
                    {
                        "type": "conversation.item.input_audio_transcription.completed",
                        "item_id": "u",
                        "transcript": "Synthetic",
                    }
                ),
                json.dumps({"type": "error", "error": {"code": "unknown", "message": "PRIVATE"}}),
            ]:
                yield event

    def connect(url, **kwargs):
        options.append((url, kwargs))
        return Socket()

    monkeypatch.setattr("src.providers.openai.connect", connect)
    observer = OpenAIObserver("fixture-secret", "rtc_owned", [])
    events = [event async for event in observer.events()]
    assert events[0].turns == [] and events[1].issue == "observer_event_error"
    assert events[3].turns[0]["text"] == "Synthetic"
    assert events[4].issue == "provider_error"
    assert options[0][0] == "wss://api.openai.com/v1/realtime?call_id=rtc_owned"
    assert options[0][1]["max_size"] == 512000 and options[0][1]["open_timeout"] == 5


async def test_integration_is_disabled_until_configured(system):
    _, client, _ = system
    status = (await client.get("/api/integrations/brainshuffle")).json()
    assert not status["configured"] and not status["automaticSync"]
    assert (await client.get(f"/api/integrations/brainshuffle/problems/{uuid.uuid4()}")).status_code == 503


def test_backend_paths_are_independent_of_shell_directory(tmp_path, monkeypatch):
    from pathlib import Path

    from src.config import ROOT
    from src.store import ConversationStore

    assert ROOT == Path(__file__).resolve().parents[1]
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("VOXA_DATABASE_PATH", raising=False)
    assert Config.from_env().database_path == str(ROOT / "data/conversations.sqlite")
    monkeypatch.setenv("VOXA_DATABASE_PATH", "data/custom.sqlite")
    assert Config.from_env().database_path == str(ROOT / "data/custom.sqlite")
    default_store = ConversationStore()
    assert default_store.path == ROOT / "data/conversations.sqlite"
    default_store.executor.shutdown(wait=False)


def test_application_loads_backend_environment_file(tmp_path, monkeypatch):
    import src.main as main

    (tmp_path / ".env").write_text("OPENAI_API_KEY=fixture-from-env\n")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(main, "ROOT", tmp_path)
    captured: list[Config] = []
    monkeypatch.setattr(main, "create_app", lambda: captured.append(Config.from_env()))
    main.application()
    assert captured[0].api_key == "fixture-from-env"
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
