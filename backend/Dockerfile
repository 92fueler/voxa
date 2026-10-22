# Build from the repository root: docker build -f backend/Dockerfile .
# Review and pin image digests before an actual deployment.
FROM python:3.13-slim-bookworm AS build
COPY --from=ghcr.io/astral-sh/uv:0.13.3 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY backend/src ./src
RUN uv sync --locked --no-dev --no-editable

FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
WORKDIR /app
RUN groupadd --gid 10001 voxa && useradd --uid 10001 --gid 10001 --no-create-home voxa
COPY --from=build --chown=10001:10001 /app/.venv /app/.venv
USER 10001:10001
EXPOSE 4318
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os,urllib.request,urllib.parse; h=urllib.parse.urlsplit(os.getenv('VOXA_PUBLIC_ORIGIN','')).netloc or '127.0.0.1:4318'; urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4318/healthz',headers={'Host':h}),timeout=3).close()"
# The application entrypoint enforces one Uvicorn worker; do not scale this service.
CMD ["voxa"]
