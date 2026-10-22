#!/bin/sh
# The official image runs this only on an EMPTY data directory.
# This script is sourced by its entrypoint; avoid changing the caller's shell options.
(
    set -eu
    : "${VOXA_DB_PASSWORD:?Set a separate application database password}"
    case "$VOXA_DB_PASSWORD" in
        *[!0-9a-fA-F]*)
            echo "VOXA_DB_PASSWORD must be hexadecimal for the Compose database URL." >&2
            exit 1
            ;;
    esac
    if [ "${#VOXA_DB_PASSWORD}" -lt 32 ]; then
        echo "VOXA_DB_PASSWORD must contain at least 32 hexadecimal characters." >&2
        exit 1
    fi
    psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password VOXA_DB_PASSWORD
CREATE ROLE voxa LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO voxa;
GRANT CONNECT, TEMPORARY ON DATABASE voxa TO voxa;
CREATE EXTENSION IF NOT EXISTS vector;
SQL
)
