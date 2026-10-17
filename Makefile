.PHONY: install dev frontend backend check build

install:
	uv sync --directory backend --locked
	npm --prefix frontend ci

dev:
	npm --prefix frontend run dev:all

frontend:
	npm --prefix frontend run dev

backend:
	uv run --directory backend --locked voxa

check:
	npm --prefix frontend run check
	uv run --directory backend --locked ruff check src tests
	uv run --directory backend --locked ruff format --check src tests
	uv run --directory backend --locked pyrefly check
	uv run --directory backend --locked pytest -q
	uv build --directory backend

build:
	npm --prefix frontend run build
	uv build --directory backend
