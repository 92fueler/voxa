import uvicorn
from dotenv import load_dotenv

from .app import create_app
from .config import ROOT


def application():
    load_dotenv(ROOT / ".env")
    return create_app()


def main():
    # One process owns ephemeral call handles and context reservations. Do not add workers.
    uvicorn.run("src.main:application", factory=True, host="127.0.0.1", port=4318, log_level="warning")


if __name__ == "__main__":
    main()
