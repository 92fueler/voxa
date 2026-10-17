import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


def project_root(module_path: Path, working_directory: Path) -> Path:
    candidate = module_path.resolve().parents[1]
    # Editable source has adjacent project metadata; a wheel is installed in site-packages.
    return candidate if (candidate / "pyproject.toml").is_file() else working_directory.resolve()


ROOT = project_root(Path(__file__), Path.cwd())


@dataclass(frozen=True)
class Config:
    api_key: str = ""
    model: str = "gpt-realtime-2.1"
    summary_model: str = "gpt-5.6-terra"
    session_max_seconds: int = 2700
    voice_provider: str = "openai"
    summary_provider: str = "openai"
    database_path: str = str(ROOT / "data/conversations.sqlite")
    brainshuffle_url: str = ""

    def __post_init__(self):
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
        )
