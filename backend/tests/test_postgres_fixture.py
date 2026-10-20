"""Validate integration URI construction without requiring a PostgreSQL server."""

import pytest
from postgres_fixture import schema_database_url
from psycopg.conninfo import conninfo_to_dict


@pytest.mark.parametrize(
    ("query", "existing_options"),
    [
        ("", ""),
        ("?sslmode=require&options=-c%20statement_timeout%3D1000", "-c statement_timeout=1000"),
    ],
)
def test_schema_url_uses_libpq_uri_space_encoding(query, existing_options):
    uri = schema_database_url(f"postgresql://fixture@localhost/archive{query}", "voxa_test_example")
    decoded = conninfo_to_dict(uri)
    options = decoded["options"]
    assert isinstance(options, str)
    assert options == f"{existing_options} -c search_path=voxa_test_example,public"
    assert "+" not in options
    assert "%20" in uri
    assert decoded["dbname"] == "archive"
    if query:
        assert decoded["sslmode"] == "require"
