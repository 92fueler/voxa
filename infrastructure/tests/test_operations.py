"""Offline failure-path tests: never touches Docker, AWS, or /srv."""
# ruff: noqa: SIM117

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "ops", Path(__file__).parents[1] / "bin/voxa-ops.py"
)
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class Operations(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.c = {
            "region": "us-east-2",
            "account_id": "044986459337",
            "origin": "https://voxa.lakechabotlabs.ai",
            "data_uuid": "12345678-1234-1234-1234-123456789abc",
            "bucket": "private-fixture",
            "backup_prefix": "voxa/postgres",
            "age_recipient": "age1" + "a" * 58,
            "postgres_image": "fixture/postgres@sha256:" + "a" * 64,
            "backend_image": "fixture/backend@sha256:" + "b" * 64,
            "web_image": "fixture/web@sha256:" + "c" * 64,
        }
        for name in ("postgres", "caddy-data", "caddy-config", "backups"):
            (self.root / name).mkdir(mode=0o700)
        self.env = "\n".join(
            [
                "POSTGRES_PASSWORD=" + "a" * 64,
                "VOXA_DB_PASSWORD=" + "b" * 64,
                "VOXA_AUTH_USERNAME=fixture",
                "VOXA_AUTH_PASSWORD=0123456789abcdef0123456789abcdef01",
                "OPENAI_API_KEY=synthetic-provider-key",
                "VOXA_PUBLIC_ORIGIN=https://voxa.lakechabotlabs.ai",
                "ACME_EMAIL=fixture@example.com",
            ]
        )
        (self.root / ".env").write_text(self.env)
        (self.root / ".env").chmod(0o600)

    def mount(self, **changes):
        m = {"target": str(self.root), "uuid": self.c["data_uuid"], "fstype": "ext4"}
        m.update(changes)
        return json.dumps({"filesystems": [m]}).encode()

    def test_placeholder_and_mutable_images_refused(self):
        p = self.root / "ops.json"
        p.write_text(json.dumps(self.c))
        p.chmod(0o600)
        self.assertEqual(ops.config(p), self.c)
        for key, value in [
            ("postgres_image", "pgvector:latest"),
            ("data_uuid", "REPLACE"),
            ("origin", "https://other.example"),
        ]:
            with self.subTest(key=key):
                p.write_text(json.dumps({**self.c, key: value}))
                with self.assertRaises(ops.Refusal):
                    ops.config(p)

    def test_public_config_refused(self):
        p = self.root / "ops.json"
        p.write_text(json.dumps(self.c))
        p.chmod(0o644)
        with self.assertRaises(ops.Refusal):
            ops.config(p)

    def test_wrong_disk_uuid_and_filesystem_refused(self):
        with patch.object(ops, "DATA", self.root):
            for mount in (
                self.mount(uuid="wrong"),
                self.mount(fstype="xfs"),
                json.dumps({"filesystems": []}).encode(),
            ):
                with patch.object(ops, "run", return_value=mount):
                    with self.assertRaises(ops.Refusal):
                        ops.storage(self.c)
            with patch.object(ops, "run", return_value=self.mount()):
                ops.storage(self.c)

    def test_symlinked_archive_directory_refused(self):
        (self.root / "postgres").rmdir()
        (self.root / "postgres").symlink_to(self.root / "backups")
        with (
            patch.object(ops, "DATA", self.root),
            patch.object(ops, "run", return_value=self.mount()),
        ):
            with self.assertRaises(ops.Refusal):
                ops.storage(self.c)

    def test_shell_cannot_override_reviewed_origin_or_secret(self):
        with (
            patch.object(ops, "ROOT", self.root),
            patch.dict(
                os.environ,
                {
                    "VOXA_PUBLIC_ORIGIN": "https://evil.example",
                    "POSTGRES_PASSWORD": "stale",
                },
            ),
        ):
            env = ops.runtime_env(self.c)
        self.assertEqual(env["VOXA_PUBLIC_ORIGIN"], self.c["origin"])
        self.assertEqual(env["POSTGRES_PASSWORD"], "a" * 64)

    def test_reused_and_interpolated_secrets_refused(self):
        for content in (
            self.env.replace("b" * 64, "a" * 64),
            self.env.replace("synthetic-provider-key", "$SECRET"),
        ):
            (self.root / ".env").write_text(content)
            with patch.object(ops, "ROOT", self.root):
                with self.assertRaises(ops.Refusal):
                    ops.runtime_env(self.c)

    def bucket(self, rules=None, accounts=None):
        return {
            "buckets": [
                {
                    "name": self.c["bucket"],
                    "accessRules": rules
                    or {"getObject": "private", "allowPublicOverrides": False},
                    "readonlyAccessAccounts": accounts or [],
                }
            ]
        }

    def test_wrong_account_blocks_archive_collection(self):
        with (
            patch.object(ops, "aws", return_value=b'{"Account":"999999999999"}'),
            patch.object(ops, "compose") as dump,
        ):
            with self.assertRaises(ops.Refusal):
                ops.backup(self.c)
            dump.assert_not_called()

    def test_public_bucket_and_overrides_and_crossaccount_refused(self):
        for b in (
            self.bucket({"getObject": "public", "allowPublicOverrides": False}),
            self.bucket({"getObject": "private", "allowPublicOverrides": True}),
            self.bucket(accounts=["999999999999"]),
        ):
            with (
                patch.object(
                    ops,
                    "aws",
                    side_effect=[
                        json.dumps({"Account": self.c["account_id"]}).encode(),
                        json.dumps(b).encode(),
                    ],
                ),
                self.assertRaises(ops.Refusal),
            ):
                ops.private_bucket(self.c)

    def test_upload_failure_removes_local_plaintext_and_never_reports_success(self):
        def fake_run(args, **_):
            if args[0] == "age":
                Path(args[args.index("--output") + 1]).write_bytes(b"encrypted-fixture")
                return b""
            raise AssertionError(args)

        with (
            patch.object(ops, "DATA", self.root),
            patch.object(ops, "private_bucket"),
            patch.object(
                ops,
                "compose",
                side_effect=lambda *a, **kw: kw["output"].write(b"PGDMPfixture"),
            ),
            patch.object(ops, "run", side_effect=fake_run),
            patch.object(ops, "aws", side_effect=ops.Refusal("upload failed")),
        ):
            with self.assertRaises(ops.Refusal):
                ops.backup(self.c)
        self.assertEqual(list((self.root / "backups").iterdir()), [])

    def test_restore_failure_removes_only_its_new_container(self):
        encrypted, identity = self.root / "dump.age", self.root / "identity"
        for p in (encrypted, identity):
            p.write_text("synthetic")
            p.chmod(0o600)
        commands = []

        def fake_run(args, **_):
            commands.append(args)
            if args[0] == "age":
                Path(args[args.index("--output") + 1]).write_bytes(b"PGDMPfixture")
            if args[:2] == ["docker", "inspect"]:
                return b"healthy"
            if args[:2] == ["docker", "exec"] and "pg_restore" in args:
                raise ops.Refusal("synthetic restore failure")
            return b""

        with (
            patch.object(ops, "DATA", self.root),
            patch.object(ops, "run", side_effect=fake_run),
        ):
            with self.assertRaises(ops.Refusal):
                ops.restore(self.c, encrypted, identity)
        self.assertIn("--network", commands[1])
        self.assertEqual(commands[1][commands[1].index("--network") + 1], "none")
        self.assertEqual(commands[-1], ["docker", "rm", "--force", commands[1][4]])

    def test_release_drift_or_different_images_refused(self):
        import hashlib

        paths = {
            "compose.production.yaml": "synthetic compose",
            "infrastructure/bin/voxa-ops.py": "synthetic source",
        }
        hashes = {}
        for name, content in paths.items():
            p = self.root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
            hashes[name] = hashlib.sha256(content.encode()).hexdigest()
        manifest = {
            "revision": "a" * 40,
            **{k: self.c[k] for k in ("postgres_image", "backend_image", "web_image")},
            "source_hashes": hashes,
        }
        marker = self.root / ".release.json"
        marker.write_text(json.dumps(manifest))
        marker.chmod(0o600)
        with patch.object(ops, "ROOT", self.root):
            ops.verify_release(self.c)
            (self.root / "compose.production.yaml").write_text("modified")
            with self.assertRaises(ops.Refusal):
                ops.verify_release(self.c)
            (self.root / "compose.production.yaml").write_text(
                paths["compose.production.yaml"]
            )
            with self.assertRaises(ops.Refusal):
                ops.verify_release({**self.c, "backend_image": "sha256:" + "d" * 64})

    def test_subprocess_error_does_not_reveal_stderr(self):
        import subprocess

        with (
            patch.object(
                ops.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 1, b"", b"private-secret"),
            ),
            self.assertRaises(ops.Refusal) as caught,
        ):
            ops.run(["aws", "test"])
        self.assertNotIn("private-secret", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
