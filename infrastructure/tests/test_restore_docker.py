"""Opt-in real PostgreSQL recovery using synthetic data and a mocked age transport.

Set VOXA_TEST_POSTGRES_IMAGE to an already-pulled reviewed pgvector digest.
No AWS, provider request, real key, host port or personal archive is used.
"""

import ast
import importlib.util
import os
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "ops_restore", ROOT / "infrastructure/bin/voxa-ops.py"
)
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


@unittest.skipUnless(
    os.environ.get("VOXA_TEST_POSTGRES_IMAGE"),
    "explicit disposable Docker image required",
)
class DockerRestore(unittest.TestCase):
    def test_real_dump_and_isolated_restore(self):
        image = os.environ["VOXA_TEST_POSTGRES_IMAGE"]
        name = "voxa-source-fixture-" + uuid.uuid4().hex
        created = False
        try:
            ops.run(
                [
                    "docker",
                    "run",
                    "--detach",
                    "--name",
                    name,
                    "--network",
                    "none",
                    "--platform",
                    "linux/amd64",
                    "--pull",
                    "never",
                    "--tmpfs",
                    "/var/lib/postgresql/data:rw,size=512m",
                    "-e",
                    "POSTGRES_HOST_AUTH_METHOD=trust",
                    "-e",
                    "POSTGRES_DB=voxa",
                    image,
                ]
            )
            created = True
            for _ in range(60):
                try:
                    ops.run(
                        [
                            "docker",
                            "exec",
                            name,
                            "pg_isready",
                            "-h",
                            "127.0.0.1",
                            "-U",
                            "postgres",
                            "-d",
                            "voxa",
                        ]
                    )
                    break
                except ops.Refusal:
                    time.sleep(1)
            else:
                self.fail("Disposable PostgreSQL did not become ready")
            tree = ast.parse((ROOT / "backend/src/postgres.py").read_text())
            migrations = next(
                ast.literal_eval(node.value)
                for node in tree.body
                if isinstance(node, ast.Assign)
                and any(
                    isinstance(t, ast.Name) and t.id == "MIGRATIONS"
                    for t in node.targets
                )
            )
            sql = "CREATE ROLE voxa NOLOGIN; CREATE EXTENSION vector; GRANT CREATE ON SCHEMA public TO voxa; SET ROLE voxa; CREATE TABLE voxa_schema_migrations(version INTEGER PRIMARY KEY);"
            for version, statements in migrations:
                sql += (
                    ";".join(statements)
                    + f";INSERT INTO voxa_schema_migrations VALUES ({version});"
                )
            sql += "INSERT INTO categories VALUES ('fixture','Synthetic'); INSERT INTO conversations(id,started_at,category_id) VALUES ('fixture',1,'fixture');"
            result = subprocess.run(
                [
                    "docker",
                    "exec",
                    "-i",
                    name,
                    "psql",
                    "-U",
                    "postgres",
                    "-d",
                    "voxa",
                    "-v",
                    "ON_ERROR_STOP=1",
                ],
                input=sql.encode(),
                check=False,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            dump = ops.run(
                [
                    "docker",
                    "exec",
                    name,
                    "pg_dump",
                    "-U",
                    "postgres",
                    "-d",
                    "voxa",
                    "-Fc",
                ]
            )
            self.assertTrue(dump.startswith(b"PGDMP"))
            with tempfile.TemporaryDirectory() as d:
                data = Path(d)
                (data / "backups").mkdir(mode=0o700)
                fixture, identity = data / "fixture.dump", data / "identity.fixture"
                fixture.write_bytes(dump)
                fixture.chmod(0o600)
                identity.write_text("NOT A REAL KEY")
                identity.chmod(0o600)

                def mock_age(args, **kwargs):
                    if args[0] == "age":
                        shutil.copyfile(args[-1], args[args.index("--output") + 1])
                        return b""
                    result = subprocess.run(
                        args,
                        input=kwargs.get("input"),
                        stdin=kwargs.get("input_file"),
                        check=False,
                        capture_output=True,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr.decode())
                    return result.stdout

                with (
                    patch.object(ops, "DATA", data),
                    patch.object(ops, "run", side_effect=mock_age),
                ):
                    ops.restore({"postgres_image": image}, fixture, identity)
                self.assertEqual(list((data / "backups").iterdir()), [])
        finally:
            if created:
                ops.run(["docker", "rm", "--force", name])


if __name__ == "__main__":
    unittest.main()
