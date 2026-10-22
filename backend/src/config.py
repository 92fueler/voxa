import os
import re
from dataclasses import dataclass, field
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlsplit

LOCAL_HOSTS = frozenset({"127.0.0.1:4318", "localhost:4318"})
LOCAL_ORIGINS = frozenset({"http://127.0.0.1:4317", "http://localhost:4317"})


def project_root(module_path: Path, working_directory: Path) -> Path:
    candidate = module_path.resolve().parents[1]
    # Editable source has adjacent project metadata; a wheel is installed in site-packages.
    return candidate if (candidate / "pyproject.toml").is_file() else working_directory.resolve()


ROOT = project_root(Path(__file__), Path.cwd())


@dataclass(frozen=True)
class Config:
    api_key: str = field(default="", repr=False)
    model: str = "gpt-realtime-2.1"
    summary_model: str = "gpt-5.6-terra"
    session_max_seconds: int = 2700
    voice_provider: str = "openai"
    summary_provider: str = "openai"
    database_path: str = str(ROOT / "data/conversations.sqlite")
    brainshuffle_url: str = ""
    environment: str = "local"
    database_url: str = field(default="", repr=False)
    public_origin: str = ""
    auth_username: str = field(default="", repr=False)
    auth_password: str = field(default="", repr=False)

    def __post_init__(self):
        if self.environment not in {"local", "local-container", "production"}:
            raise ValueError("VOXA_ENV must be local, local-container, or production.")
        if self.database_url:
            try:
                database = urlsplit(self.database_url)
                valid_database = (
                    database.scheme in {"postgres", "postgresql"}
                    and bool(database.hostname)
                    and database.path not in {"", "/"}
                    and not database.fragment
                    and not any(c.isspace() for c in self.database_url)
                    and database.port != 0
                )
            except ValueError:
                valid_database = False
            if not valid_database:
                raise ValueError("DATABASE_URL must be a PostgreSQL URL with a host and database name.")
        if self.environment == "production":
            self._validate_production()
        elif self.public_origin or self.auth_username or self.auth_password:
            raise ValueError("Public origin and authentication settings require VOXA_ENV=production.")
        if type(self.session_max_seconds) is not int or not 30 <= self.session_max_seconds <= 2700:
            raise ValueError("SESSION_MAX_SECONDS must be an integer between 30 and 2700.")
        if self.voice_provider == "openai" and self.model not in (
            "gpt-realtime-2.1",
            "gpt-realtime-2.1-mini",
        ):
            raise ValueError("Unsupported OpenAI REALTIME_MODEL.")
        if self.brainshuffle_url:
            url = urlsplit(self.brainshuffle_url)
            if (
                url.scheme != "http"
                or url.hostname not in ("127.0.0.1", "localhost", "::1")
                or url.username
                or url.password
                or url.query
                or url.fragment
                or url.path not in ("", "/")
            ):
                raise ValueError(
                    "BRAINSHUFFLE_URL must be a loopback HTTP origin, for example http://127.0.0.1:8000."
                )
            _ = url.port

    def _validate_production(self):
        if not self.database_url:
            raise ValueError("Production requires DATABASE_URL; SQLite is local-only.")
        try:
            origin = urlsplit(self.public_origin)
            hostname = origin.hostname or ""
            try:
                address = ip_address(hostname)
                public_host = address.is_global and not address.is_multicast
            except ValueError:
                public_host = (
                    "." in hostname
                    and len(hostname) <= 253
                    and not hostname.rsplit(".", 1)[-1].isdigit()
                    and not hostname.endswith((".localhost", ".local", ".internal"))
                    and all(
                        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                        for label in hostname.split(".")
                    )
                )
            host = f"[{hostname}]" if ":" in hostname else hostname
            port = origin.port
            canonical = f"https://{host}" + (f":{port}" if port not in {None, 443} else "")
            valid_origin = (
                origin.scheme == "https" and public_host and port != 0 and self.public_origin == canonical
            )
        except ValueError:
            valid_origin = False
        if not valid_origin:
            raise ValueError(
                "Production requires VOXA_PUBLIC_ORIGIN as a canonical public HTTPS origin "
                "without credentials, path, trailing slash, query, or fragment."
            )
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", self.auth_username):
            raise ValueError("Production requires VOXA_AUTH_USERNAME (1–64 letters, digits, ., _, or -).")
        if (
            not 32 <= len(self.auth_password) <= 256
            or any(ord(c) < 33 or ord(c) > 126 for c in self.auth_password)
            or len(set(self.auth_password)) < 12
        ):
            raise ValueError(
                "Production requires a generated VOXA_AUTH_PASSWORD with 32–256 printable ASCII "
                "characters, no spaces, and at least 12 distinct characters."
            )

    @property
    def bind_host(self) -> str:
        # Container access is opt-in; default development never binds beyond loopback.
        return "127.0.0.1" if self.environment == "local" else "0.0.0.0"

    @property
    def trusted_hosts(self) -> frozenset[str]:
        if self.environment == "production":
            return frozenset({urlsplit(self.public_origin).netloc})
        if self.environment == "local-container":
            return LOCAL_HOSTS | {"127.0.0.1:4317", "localhost:4317"}
        return LOCAL_HOSTS

    @property
    def trusted_origins(self) -> frozenset[str]:
        return frozenset({self.public_origin}) if self.environment == "production" else LOCAL_ORIGINS

    @classmethod
    def from_env(cls):
        return cls(
            api_key=os.getenv("OPENAI_API_KEY", "").strip(),
            model=os.getenv("REALTIME_MODEL", "gpt-realtime-2.1"),
            summary_model=os.getenv("SUMMARY_MODEL", "gpt-5.6-terra"),
            session_max_seconds=int(os.getenv("SESSION_MAX_SECONDS", "2700")),
            voice_provider=os.getenv("VOICE_PROVIDER", "openai"),
            summary_provider=os.getenv("SUMMARY_PROVIDER", "openai"),
            database_path=str(ROOT / os.getenv("VOXA_DATABASE_PATH", "data/conversations.sqlite")),
            brainshuffle_url=os.getenv("BRAINSHUFFLE_URL", "").rstrip("/"),
            environment=os.getenv("VOXA_ENV", "local"),
            database_url=os.getenv("DATABASE_URL", ""),
            public_origin=os.getenv("VOXA_PUBLIC_ORIGIN", ""),
            auth_username=os.getenv("VOXA_AUTH_USERNAME", ""),
            auth_password=os.getenv("VOXA_AUTH_PASSWORD", ""),
        )
