"""Opt-in integration isolation: a fresh schema, never a database-wide cleanup."""

import os
import uuid
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
import pytest
from psycopg import sql


@pytest.fixture
def postgres_url():
    url = os.getenv("VOXA_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set VOXA_TEST_DATABASE_URL for disposable PostgreSQL integration tests.")
    schema = "voxa_test_" + uuid.uuid4().hex
    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query))
    query["options"] = query.get("options", "") + f" -c search_path={schema},public"
    isolated = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
    try:
        yield isolated
    finally:
        with psycopg.connect(url, autocommit=True) as connection:
            connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
