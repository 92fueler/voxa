import uvicorn
from dotenv import load_dotenv

from .app import create_app
from .config import ROOT, Config


def application():
    load_dotenv(ROOT / ".env")
    return create_app()


def main():
    load_dotenv(ROOT / ".env")
    config = Config.from_env()
    # One process owns ephemeral call handles and context reservations. Do not add workers.
    # The proxy preserves Host. Forwarded client addresses/schemes never relax access controls.
    uvicorn.run(
        "src.main:application",
        factory=True,
        host=config.bind_host,
        port=4318,
        workers=1,
        proxy_headers=False,
        access_log=False,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
