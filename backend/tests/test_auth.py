"""Offline access-boundary fixtures; no real credentials, database server, or provider requests."""

import base64
from dataclasses import replace

import httpx
import pytest
from conftest import FakeProvider

from src.app import create_app
from src.config import Config

PUBLIC_ORIGIN = "https://voice.example.test"
USERNAME = "fixture-user"
PASSWORD = "fixture-only-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ"
DATABASE_URL = "postgresql://fixture:synthetic-secret@db:5432/fixture"


def production_config(**overrides):
    return replace(
        Config(
            environment="production",
            database_url=DATABASE_URL,
            public_origin=PUBLIC_ORIGIN,
            auth_username=USERNAME,
            auth_password=PASSWORD,
        ),
        **overrides,
    )


def basic(username=USERNAME, password=PASSWORD):
    encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {encoded}"


@pytest.fixture
async def cloud_system(store):
    provider = FakeProvider()
    app = create_app(production_config(), store=store, voice_provider=provider, summary_provider=provider)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=PUBLIC_ORIGIN
        ) as client:
            yield app, client, provider


@pytest.mark.parametrize(
    "settings",
    [
        {"environment": ""},
        {"environment": "prod"},
        {"database_url": ""},
        {"database_url": "sqlite:///private.sqlite"},
        {"database_url": "postgresql:///fixture"},
        {"database_url": "postgresql://db"},
        {"database_url": "postgresql://db:bad/fixture"},
        {"public_origin": ""},
        {"public_origin": "http://voice.example.test"},
        {"public_origin": "https://localhost"},
        {"public_origin": "https://127.0.0.1"},
        {"public_origin": "https://127.1"},
        {"public_origin": "https://[::1]"},
        {"public_origin": "https://10.1.2.3"},
        {"public_origin": "https://224.0.0.1"},
        {"public_origin": "https://voxa.local"},
        {"public_origin": "https://voice.example.test/"},
        {"public_origin": "https://voice.example.test/path"},
        {"public_origin": "https://voice.example.test?query=1"},
        {"public_origin": "https://voice.example.test#fragment"},
        {"public_origin": "https://user:password@voice.example.test"},
        {"public_origin": "https://voice.example.test:443"},
        {"public_origin": "https://voice.example.test:0"},
        {"public_origin": "https://voice.example.test:bad"},
        {"public_origin": "https://*.example.test"},
        {"public_origin": "https://voice.example.test\n"},
        {"auth_username": ""},
        {"auth_username": "fixture:user"},
        {"auth_password": ""},
        {"auth_password": "short"},
        {"auth_password": "x" * 32},
        {"auth_password": PASSWORD + " "},
        {"auth_password": PASSWORD + "\n"},
        {"auth_password": PASSWORD + "密"},
        {"auth_password": PASSWORD * 6},
    ],
)
def test_production_configuration_fails_closed(settings):
    with pytest.raises(ValueError):
        production_config(**settings)


def test_configuration_selects_exact_origins_and_container_binding():
    local = Config()
    assert local.bind_host == "127.0.0.1"
    assert local.trusted_hosts == {"127.0.0.1:4318", "localhost:4318"}
    assert local.trusted_origins == {"http://127.0.0.1:4317", "http://localhost:4317"}
    container = Config(environment="local-container")
    assert container.bind_host == "0.0.0.0"
    assert container.trusted_hosts == local.trusted_hosts | {"127.0.0.1:4317", "localhost:4317"}
    assert container.trusted_origins == local.trusted_origins
    production = production_config(public_origin=PUBLIC_ORIGIN + ":8443")
    assert production.bind_host == "0.0.0.0"
    assert production.trusted_hosts == {"voice.example.test:8443"}
    assert production.trusted_origins == {PUBLIC_ORIGIN + ":8443"}


def test_production_secrets_are_not_in_configuration_repr():
    config = production_config(api_key="fixture-provider-private")
    for secret in [DATABASE_URL, PASSWORD, USERNAME, config.api_key]:
        assert secret not in repr(config)


@pytest.mark.parametrize("environment", ["local", "local-container"])
@pytest.mark.parametrize(
    "settings", [{"public_origin": PUBLIC_ORIGIN}, {"auth_username": USERNAME}, {"auth_password": PASSWORD}]
)
def test_cloud_configuration_cannot_silently_run_as_local(environment, settings):
    with pytest.raises(ValueError, match="require VOXA_ENV=production"):
        Config(environment=environment, **settings)


def test_environment_configuration_is_explicit(monkeypatch):
    for key, value in {
        "VOXA_ENV": "production",
        "DATABASE_URL": DATABASE_URL,
        "VOXA_PUBLIC_ORIGIN": PUBLIC_ORIGIN,
        "VOXA_AUTH_USERNAME": USERNAME,
        "VOXA_AUTH_PASSWORD": PASSWORD,
    }.items():
        monkeypatch.setenv(key, value)
    config = Config.from_env()
    assert config.environment == "production"
    assert config.database_url == DATABASE_URL
    assert config.public_origin == PUBLIC_ORIGIN
    assert config.auth_username == USERNAME
    assert config.auth_password == PASSWORD


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer fixture"},
        {"Authorization": basic(password="incorrect-password")},
        {"Authorization": basic(username="other-user")},
        {"Authorization": "Basic not-valid-base64!"},
        {"Authorization": "Basic " + base64.b64encode(b"no-colon").decode()},
        {"Authorization": "Basic " + "a" * 2049},
        [("Authorization", basic()), ("Authorization", basic())],
    ],
)
async def test_production_requires_valid_auth_before_provider_or_archive_access(cloud_system, headers):
    _, client, provider = cloud_system
    for path in ["/api/health", "/api/conversations", "/openapi.json"]:
        response = await client.get(path, headers=headers)
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == 'Basic realm="Voxa", charset="UTF-8"'
        assert response.headers["cache-control"] == "no-store"
        assert PASSWORD not in response.text
    response = await client.post("/api/session", json={}, headers=headers)
    assert response.status_code == 401
    assert not provider.created


async def test_authenticated_health_is_safe_and_provider_independent(cloud_system):
    _, client, provider = cloud_system
    response = await client.get(
        "/api/health",
        headers={"Authorization": basic(), "Origin": PUBLIC_ORIGIN, "Sec-Fetch-Site": "same-origin"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "realtimeConfigured": True,
        "model": "fixture-voice",
        "sessionMaxSeconds": 2700,
    }
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    for secret in [PASSWORD, DATABASE_URL, USERNAME]:
        assert secret not in response.text
    assert not provider.created
    assert not provider.summary_calls
    assert (await client.get("/openapi.json", headers={"Authorization": basic()})).status_code == 404
    # A native HTTPS client has no browser Origin; credentials still remain mandatory.
    assert (await client.get("/api/health", headers={"Authorization": basic()})).status_code == 200


async def test_authenticated_session_keeps_existing_body_and_validation_bounds(cloud_system):
    _, client, provider = cloud_system
    headers = {"Authorization": basic(), "Origin": PUBLIC_ORIGIN}
    response = await client.post("/api/session", json={}, headers=headers)
    assert response.status_code == 200
    assert len(provider.created) == 1
    assert (await client.post("/api/session", content=b"x" * 1025, headers=headers)).status_code == 413
    assert (await client.post("/api/session", json={"apiKey": PASSWORD}, headers=headers)).status_code == 400
    assert len(provider.created) == 1
    assert (await client.post("/api/session", content=b"x" * 1025)).status_code == 401


@pytest.mark.parametrize(
    "headers",
    [
        {"Host": "127.0.0.1:4318"},
        {"Host": "localhost:4318"},
        {"Host": "backend:4318"},
        {"Host": "evil.example.test"},
        {"Host": "voice.example.test:443"},
        {"Origin": "http://127.0.0.1:4317"},
        {"Origin": "http://localhost:4317"},
        {"Origin": "https://evil.example.test"},
        {"Origin": "null"},
        {"Origin": PUBLIC_ORIGIN + "/"},
        {"Origin": PUBLIC_ORIGIN + ":8443"},
        {"Sec-Fetch-Site": "cross-site"},
        {"Sec-Fetch-Site": "same-site"},
        {"Host": "evil.example.test", "X-Forwarded-Host": "voice.example.test"},
        {"Origin": "https://evil.example.test", "X-Forwarded-For": "127.0.0.1"},
    ],
)
async def test_production_has_no_local_or_forwarded_header_exemption(cloud_system, headers):
    _, client, provider = cloud_system
    response = await client.post("/api/session", json={}, headers={"Authorization": basic(), **headers})
    assert response.status_code == 403
    assert not provider.created
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize(
    "duplicate",
    [
        [("Host", "voice.example.test"), ("Host", "evil.example.test")],
        [("Origin", PUBLIC_ORIGIN), ("Origin", PUBLIC_ORIGIN)],
        [("Sec-Fetch-Site", "same-origin"), ("Sec-Fetch-Site", "cross-site")],
    ],
)
async def test_ambiguous_security_headers_are_rejected(cloud_system, duplicate):
    _, client, _ = cloud_system
    response = await client.get("/api/health", headers=[("Authorization", basic()), *duplicate])
    assert response.status_code == 403


async def test_liveness_exposes_no_configuration_and_keeps_host_guard(cloud_system):
    _, client, provider = cloud_system
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert (await client.get("/healthz", headers={"Host": "localhost:4318"})).status_code == 403
    assert (await client.get("/healthz/")).status_code == 401
    assert not provider.created


async def test_production_storage_failure_stops_startup_without_leaking_credentials(store, monkeypatch):
    async def unavailable(operation, payload=None):
        raise RuntimeError(DATABASE_URL)

    monkeypatch.setattr(store, "run", unavailable)
    provider = FakeProvider()
    app = create_app(production_config(), store=store, voice_provider=provider, summary_provider=provider)
    with pytest.raises(RuntimeError, match="^Production conversation storage is unavailable.$") as exc:
        async with app.router.lifespan_context(app):
            pytest.fail("An unavailable production database must prevent startup.")
    assert DATABASE_URL not in str(exc.value)
    assert exc.value.__suppress_context__
    assert store.closed
    assert not provider.created
    assert not provider.summary_calls


async def test_app_passes_explicit_database_url_to_store(store, monkeypatch):
    import src.app as app_module

    selected = []

    def make_store(path, *, database_url=None):
        selected.append((path, database_url))
        return store

    monkeypatch.setattr(app_module, "ConversationStore", make_store)
    provider = FakeProvider()
    config = production_config()
    app = create_app(config, voice_provider=provider, summary_provider=provider)
    async with app.router.lifespan_context(app):
        assert app.state.store is store
        assert selected == [(config.database_path, DATABASE_URL)]


@pytest.mark.parametrize("environment", ["local", "local-container", "production"])
def test_launcher_explicitly_uses_single_worker_and_distrusts_proxy_headers(environment, monkeypatch):
    import src.main as main

    config = production_config() if environment == "production" else Config(environment=environment)
    monkeypatch.setattr(main, "load_dotenv", lambda *_: None)
    monkeypatch.setattr(main.Config, "from_env", lambda: config)
    calls = []
    monkeypatch.setattr(main.uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs)))
    main.main()
    args, options = calls[0]
    assert args == ("src.main:application",)
    assert options["host"] == config.bind_host
    assert options["port"] == 4318
    assert options["workers"] == 1
    assert options["proxy_headers"] is False
    assert options["access_log"] is False


async def test_local_default_stays_guarded_and_container_access_is_explicit(store):
    provider = FakeProvider()
    config = Config()
    for container, expected in [(False, 403), (True, 200)]:
        service_client = httpx.AsyncClient(trust_env=False)
        app = create_app(
            replace(config, environment="local-container" if container else "local"),
            store=store,
            voice_provider=provider,
            summary_provider=provider,
            client=service_client,
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://localhost:4317"
        ) as client:
            assert (await client.get("/api/health")).status_code == expected
            assert (await client.get("/api/health", headers={"Host": "0.0.0.0:4318"})).status_code == 403
            assert (
                await client.get("/api/health", headers={"Origin": "https://evil.example.test"})
            ).status_code == 403
        # This fixture intentionally skips lifespan because both apps share one synthetic store.
        await app.state.captures.close()
        await app.state.summaries.close()
        await service_client.aclose()
