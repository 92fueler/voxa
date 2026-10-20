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


# Compatibility alias for the old command; source lives only in web-client/.
.PHONY: frontend ios-client install-ios check-ios local local-down database
frontend: web-client

install-ios:
	npm --prefix ios-client ci

ios-client:
	npm --prefix ios-client start

check-ios:
	npm --prefix ios-client run check

# Run the shared PostgreSQL stack without any AWS account or provisioning.
local:
	docker compose up --build -d

local-down:
	docker compose down

database:
	docker compose up -d postgres

.PHONY: install-all check-all
install-all: install install-ios

check-all: check check-ios

.PHONY: database-dev
database-dev:
	docker compose -f compose.yaml -f compose.dev.yaml up -d postgres
