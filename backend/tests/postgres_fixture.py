"""Opt-in integration isolation: a fresh schema, never a database-wide cleanup."""

import os
import uuid
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import psycopg
import pytest
from psycopg import sql


def schema_database_url(url, schema):
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query))
    query["options"] = query.get("options", "") + f" -c search_path={schema},public"
    # libpq URI decoding understands %20, not form-encoded '+' for spaces.
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query, quote_via=quote), parts.fragment)
    )


@pytest.fixture
def postgres_url():
    url = os.getenv("VOXA_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set VOXA_TEST_DATABASE_URL for disposable PostgreSQL integration tests.")
    schema = "voxa_test_" + uuid.uuid4().hex
    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    isolated = schema_database_url(url, schema)
    try:
        yield isolated
    finally:
        with psycopg.connect(url, autocommit=True) as connection:
            connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
