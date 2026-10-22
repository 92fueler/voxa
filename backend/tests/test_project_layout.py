"""Repository layout regressions; no credentials, service startup or provider calls."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_client_ownership_and_root_commands():
    assert (ROOT / "web-client/src/App.tsx").is_file()
    assert not (ROOT / "frontend").exists()
    package = json.loads((ROOT / "web-client/package.json").read_text())
    assert package["name"] == "voxa-web-client"
    assert "../backend" in package["scripts"]["dev:server"]
    makefile = (ROOT / "Makefile").read_text()
    assert "npm --prefix frontend" not in makefile
    assert "npm --prefix web-client" in makefile
    assert "docker compose down -v" not in makefile


def test_both_browser_ports_remain_explicit_and_strict():
    vite = (ROOT / "web-client/vite.config.ts").read_text()
    assert "port: 4317" in vite
    assert "strictPort: true" in vite
    assert "http://127.0.0.1:4318" in vite
    assert "5173" not in vite


def test_native_database_override_is_loopback_only():
    override = (ROOT / "compose.dev.yaml").read_text()
    assert '"127.0.0.1:54329:5432"' in override
    assert "0.0.0.0" not in override
    assert "compose.dev.yaml" not in (ROOT / "compose.production.yaml").read_text()
