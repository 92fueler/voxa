.PHONY: install dev web-client backend check build

install:
	uv sync --directory backend --locked
	npm --prefix web-client ci

dev:
	npm --prefix web-client run dev:all

web-client:
	npm --prefix web-client run dev

backend:
	uv run --directory backend --locked voxa

check:
	npm --prefix web-client run check
	uv run --directory backend --locked ruff check src tests
	uv run --directory backend --locked ruff format --check src tests
	uv run --directory backend --locked pyrefly check
	uv run --directory backend --locked pytest -q
	uv build --directory backend

build:
	npm --prefix web-client run build
	uv build --directory backend
