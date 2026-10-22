#!/usr/bin/env python3
"""Explicit single-host operations. No credentials, provisioning, or disk formatting."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path("/srv/voxa")
CONFIG = Path("/etc/voxa/operations.json")


class Refusal(Exception):
    pass


def run(args, *, env=None, input=None, output=None, input_file=None):
    # Never echo commands, environment, provider output, or private dump contents.
    result = subprocess.run(
        args,
        input=input,
        stdin=input_file,
        stdout=output if output is not None else subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
        timeout=900,
    )
    if result.returncode:
        raise Refusal(f"{args[0]} failed; inspect locally without publishing secrets.")
    return result.stdout


def private_file(path):
    if path.is_symlink() or not path.is_file():
        raise Refusal("Expected a regular private configuration/input file.")
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise Refusal(
            "Configuration/input file must not be accessible by group or others."
        )


def config(path):
    private_file(path)
    c = json.loads(path.read_text())
    required = {
        "region",
        "account_id",
        "origin",
        "data_uuid",
        "bucket",
        "backup_prefix",
        "age_recipient",
        "postgres_image",
        "backend_image",
        "web_image",
    }
    if set(c) != required or any(not isinstance(v, str) for v in c.values()):
        raise Refusal("Unexpected or missing operations configuration fields.")
    if any("REPLACE" in v for v in c.values()):
        raise Refusal("Replace and review every operations placeholder.")
    if not re.fullmatch(r"[a-z]{2}-[a-z]+-\d", c["region"]):
        raise Refusal("Invalid region.")
    if not re.fullmatch(r"\d{12}", c["account_id"]):
        raise Refusal("Invalid AWS account ID.")
    if c["origin"] != "https://voxa.lakechabotlabs.ai":
        raise Refusal(
            "This release is reviewed only for https://voxa.lakechabotlabs.ai."
        )
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", c["data_uuid"]):
        raise Refusal("Require the reviewed filesystem UUID, not a guest device name.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,52}[a-z0-9]", c["bucket"]):
        raise Refusal("Invalid bucket name.")
    if not re.fullmatch(r"[a-zA-Z0-9/_-]+", c["backup_prefix"]):
        raise Refusal("Invalid backup prefix.")
    if not re.fullmatch(r"age1[0-9a-z]{58}", c["age_recipient"]):
        raise Refusal(
            "Require an age public recipient; never put a private identity here."
        )
    for key in ("postgres_image", "backend_image", "web_image"):
        if not re.fullmatch(r"(?:[a-zA-Z0-9._:/-]+@)?sha256:[0-9a-f]{64}", c[key]):
            raise Refusal(
                "All release images must use reviewed immutable repository digests."
            )
    return c


def storage(c):
    mount = json.loads(
        run(
            [
                "findmnt",
                "--json",
                "--mountpoint",
                str(DATA),
                "--output",
                "TARGET,UUID,FSTYPE",
            ]
        ).decode()
    )
    mounts = mount.get("filesystems", [])
    if len(mounts) != 1 or mounts[0].get("target") != str(DATA):
        raise Refusal("Data disk must be a distinct mount at /srv/voxa.")
    if mounts[0].get("uuid", "").lower() != c["data_uuid"].lower():
        raise Refusal("Mounted data disk UUID does not match the reviewed disk.")
    if mounts[0].get("fstype") != "ext4":
        raise Refusal("Only the reviewed ext4 data filesystem is supported.")
    for name in ("postgres", "caddy-data", "caddy-config", "backups"):
        p = DATA / name
        if p.is_symlink() or not p.is_dir():
            raise Refusal(
                "Missing or symlinked persistent directory; do not create fallback storage."
            )
        if stat.S_IMODE(p.stat().st_mode) & 0o077:
            raise Refusal("Persistent directories must be private (mode 0700).")


def runtime_env(c):
    p = ROOT / ".env"
    private_file(p)
    values = {}
    for line in p.read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            key, sep, value = line.partition("=")
            if not sep or key != key.strip() or key in values:
                raise Refusal(
                    "Use unique, unquoted KEY=value entries in production .env."
                )
            values[key] = value
    for key in ("POSTGRES_PASSWORD", "VOXA_DB_PASSWORD"):
        if not re.fullmatch(r"[0-9a-fA-F]{64}", values.get(key, "")):
            raise Refusal(
                "Use independent 64-character hexadecimal database passwords."
            )
    auth = values.get("VOXA_AUTH_PASSWORD", "")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", values.get("VOXA_AUTH_USERNAME", "")):
        raise Refusal("Invalid Basic authentication username.")
    if (
        not 32 <= len(auth) <= 256
        or len(set(auth)) < 12
        or not re.fullmatch(r"[!-~]+", auth)
    ):
        raise Refusal(
            "Basic authentication password does not meet the production policy."
        )
    secrets = [
        values["POSTGRES_PASSWORD"],
        values["VOXA_DB_PASSWORD"],
        auth,
        values.get("OPENAI_API_KEY", ""),
    ]
    if len(set(secrets)) != 4 or not secrets[-1] or "REPLACE" in secrets[-1]:
        raise Refusal("Independent database, Basic, and provider secrets are required.")
    # Compose performs interpolation: reject ambiguous values rather than changing secrets.
    if any(
        any(ch in value for ch in ("$", '"', "'", "\\", "#", " "))
        for value in values.values()
    ):
        raise Refusal(
            "Use unambiguous unquoted values without Compose interpolation characters."
        )
    if values.get("VOXA_PUBLIC_ORIGIN") != c["origin"]:
        raise Refusal("Runtime origin differs from reviewed operations origin.")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", values.get("ACME_EMAIL", "")):
        raise Refusal("Set the approved ACME contact email.")
    limit = values.get("SESSION_MAX_SECONDS", "2700")
    if not limit.isdigit() or not 30 <= int(limit) <= 2700:
        raise Refusal("Session duration must be 30–2700 seconds.")
    env = os.environ.copy()
    # Prevent stale shell variables from silently overriding this release's .env.
    for key in (
        "POSTGRES_PASSWORD",
        "VOXA_DB_PASSWORD",
        "VOXA_AUTH_USERNAME",
        "VOXA_AUTH_PASSWORD",
        "OPENAI_API_KEY",
        "VOXA_PUBLIC_ORIGIN",
        "ACME_EMAIL",
        "REALTIME_MODEL",
        "SUMMARY_MODEL",
        "SESSION_MAX_SECONDS",
    ):
        env.pop(key, None)
    env.update(values)
    env.update(
        VOXA_POSTGRES_IMAGE=c["postgres_image"],
        VOXA_BACKEND_IMAGE=c["backend_image"],
        VOXA_WEB_IMAGE=c["web_image"],
    )
    return env


def compose(c, *args, output=None):
    return run(
        [
            "docker",
            "compose",
            "--project-name",
            "voxa-production",
            "--project-directory",
            str(ROOT),
            "--env-file",
            str(ROOT / ".env"),
            "-f",
            str(ROOT / "compose.production.yaml"),
            "-f",
            str(ROOT / "compose.release.yaml"),
            *args,
        ],
        env=runtime_env(c),
        output=output,
    )


@contextmanager
def lock():
    # Same lock for backup/deploy: prevent a new rollout during the logical dump.
    p = DATA / "backups" / ".operations.lock"
    fd = os.open(p, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as file:
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refusal("Another deployment or backup operation is running.")
        yield


def aws(c, *args):
    return run(["aws", "--region", c["region"], "--no-cli-pager", *args])


def private_bucket(c):
    identity = json.loads(aws(c, "sts", "get-caller-identity", "--output", "json"))
    if identity.get("Account") != c["account_id"]:
        raise Refusal("AWS identity belongs to a different account.")
    response = json.loads(
        aws(
            c,
            "lightsail",
            "get-buckets",
            "--bucket-name",
            c["bucket"],
            "--output",
            "json",
        )
    )
    buckets = response.get("buckets", [])
    if len(buckets) != 1 or buckets[0].get("name") != c["bucket"]:
        raise Refusal("Expected one reviewed Lightsail bucket.")
    rules = buckets[0].get("accessRules", {})
    if (
        rules.get("getObject") != "private"
        or rules.get("allowPublicOverrides") is not False
    ):
        raise Refusal("Backup bucket must be private with public overrides disabled.")
    if buckets[0].get("readonlyAccessAccounts"):
        raise Refusal("Backup bucket has unreviewed cross-account read access.")


def backup(c):
    private_bucket(c)  # Refuse before collecting private archive data.
    with tempfile.TemporaryDirectory(prefix=".backup-", dir=DATA / "backups") as d:
        d = Path(d)
        dump = d / "archive.dump"
        with dump.open("xb") as out:
            compose(
                c,
                "exec",
                "-T",
                "postgres",
                "pg_dump",
                "-U",
                "postgres",
                "-d",
                "voxa",
                "--format=custom",
                output=out,
            )
        with dump.open("rb") as source:
            valid = source.read(5) == b"PGDMP"
        if not dump.stat().st_size or not valid:
            raise Refusal("Database did not produce a PostgreSQL custom-format dump.")
        encrypted = d / "archive.dump.age"
        run(
            [
                "age",
                "--recipient",
                c["age_recipient"],
                "--output",
                str(encrypted),
                str(dump),
            ]
        )
        key = f"{c['backup_prefix'].strip('/')}/{datetime.now(UTC):%Y/%m/%d/%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex}.dump.age"
        aws(
            c,
            "s3",
            "cp",
            str(encrypted),
            f"s3://{c['bucket']}/{key}",
            "--only-show-errors",
            "--no-progress",
        )
        size = json.loads(
            aws(
                c,
                "s3api",
                "head-object",
                "--bucket",
                c["bucket"],
                "--key",
                key,
                "--output",
                "json",
            )
        ).get("ContentLength")
        if size != encrypted.stat().st_size:
            raise Refusal("Uploaded encrypted backup size could not be verified.")
        # No automatic local/remote deletion or lifecycle changes. Retention is separately approved.
        print(
            "Encrypted off-host backup uploaded and size verified. Restore rehearsal is still required."
        )


def restore(c, encrypted, identity):
    private_file(encrypted)
    private_file(identity)
    name = "voxa-restore-" + uuid.uuid4().hex
    created = False
    with tempfile.TemporaryDirectory(prefix=".restore-", dir=DATA / "backups") as d:
        dump = Path(d) / "archive.dump"
        run(
            [
                "age",
                "--decrypt",
                "--identity",
                str(identity),
                "--output",
                str(dump),
                str(encrypted),
            ]
        )
        try:
            # Entirely isolated, ephemeral database; trust is safe only with network=none.
            run(
                [
                    "docker",
                    "run",
                    "--detach",
                    "--name",
                    name,
                    "--network",
                    "none",
                    "--tmpfs",
                    "/var/lib/postgresql/data:rw,size=1g",
                    "--tmpfs",
                    "/var/run/postgresql:rw",
                    "--tmpfs",
                    "/tmp:rw,size=1g",
                    "--pull",
                    "never",
                    "--platform",
                    "linux/amd64",
                    "-e",
                    "POSTGRES_HOST_AUTH_METHOD=trust",
                    "-e",
                    "POSTGRES_DB=voxa",
                    "--health-cmd",
                    "pg_isready -h 127.0.0.1 -U postgres -d voxa",
                    "--health-interval",
                    "1s",
                    "--health-retries",
                    "60",
                    c["postgres_image"],
                ]
            )
            created = True
            import time

            for _ in range(90):
                status = run(
                    ["docker", "inspect", "--format", "{{.State.Health.Status}}", name]
                ).strip()
                if status == b"healthy":
                    break
                if status == b"unhealthy":
                    raise Refusal("Isolated restore database did not become healthy.")
                time.sleep(1)
            else:
                raise Refusal("Isolated restore database timed out.")
            run(
                [
                    "docker",
                    "exec",
                    name,
                    "psql",
                    "-U",
                    "postgres",
                    "-d",
                    "voxa",
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-c",
                    "CREATE ROLE voxa NOLOGIN;",
                ]
            )
            with dump.open("rb") as source:
                restore_args = [
                    "docker",
                    "exec",
                    "-i",
                    name,
                    "pg_restore",
                    "-U",
                    "postgres",
                    "-d",
                    "voxa",
                    "--exit-on-error",
                    "--single-transaction",
                ]
                run(restore_args, input_file=source)
            sql = """DO $$ BEGIN
IF NOT EXISTS (SELECT FROM pg_extension WHERE extname='vector') THEN RAISE EXCEPTION 'vector absent'; END IF;
IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='voxa_schema_migrations') THEN RAISE EXCEPTION 'schema absent'; END IF;
END $$;
SET ROLE voxa;
SELECT count(*) FROM conversations;
SELECT count(*) FROM turns;
SELECT count(*) FROM summaries;
SELECT count(*) FROM categories;
"""
            run(
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
            )
            print(
                "Isolated restore passed: archive restored transactionally, vector/schema present, app role reads all archive tables. Content parity and application smoke checks remain manual."
            )
        finally:
            if created:
                run(["docker", "rm", "--force", name])


def verify_release(c):
    marker = ROOT / ".release.json"
    private_file(marker)
    manifest = json.loads(marker.read_text())
    if not re.fullmatch(r"[0-9a-f]{40}", manifest.get("revision", "")):
        raise Refusal("Require a reviewed source revision in .release.json.")
    for key in ("postgres_image", "backend_image", "web_image"):
        if manifest.get(key) != c[key]:
            raise Refusal(
                "Operations images differ from the reviewed release manifest."
            )
    hashes = manifest.get("source_hashes", {})
    if (
        not hashes
        or "compose.production.yaml" not in hashes
        or "infrastructure/bin/voxa-ops.py" not in hashes
    ):
        raise Refusal("Release manifest lacks source verification hashes.")
    for relative, expected in hashes.items():
        p = ROOT / relative
        if (
            Path(relative).is_absolute()
            or ".." in Path(relative).parts
            or p.is_symlink()
            or not p.is_file()
        ):
            raise Refusal("Invalid release source path.")
        if hashlib.sha256(p.read_bytes()).hexdigest() != expected:
            raise Refusal(
                "Source differs from the reviewed release. Build a new release rather than editing the host."
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=CONFIG)
    parser.add_argument(
        "action",
        choices=["validate", "storage-check", "deploy", "backup", "restore-check"],
    )
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--encrypted-dump", type=Path)
    parser.add_argument("--identity", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        c = config(args.config)
        storage(c)
        if args.action == "storage-check":
            print("Expected private data filesystem is mounted.")
            return
        if args.action in ("validate", "deploy"):
            compose(c, "config", "--quiet")
            # Read-only manifest inspection catches accidental ARM-only releases.
            for key in ("postgres_image", "backend_image", "web_image"):
                info = json.loads(
                    run(
                        [
                            "docker",
                            "image",
                            "inspect",
                            "--platform",
                            "linux/amd64",
                            c[key],
                        ]
                    )
                )
                if (
                    len(info) != 1
                    or info[0].get("Os") != "linux"
                    or info[0].get("Architecture") != "amd64"
                ):
                    raise Refusal(
                        "Preload reviewed linux/amd64 release images before deployment."
                    )
        if args.action == "validate":
            print(
                "Configuration, expected storage and local immutable amd64 images validated."
            )
            return
        if not args.execute:
            print(
                f"{args.action}: preconditions checked; no mutation. Review and use --execute only after approval."
            )
            return
        with lock():
            if args.action == "deploy":
                verify_release(c)
                compose(
                    c,
                    "up",
                    "-d",
                    "--wait",
                    "--wait-timeout",
                    "180",
                    "--no-build",
                    "--pull",
                    "never",
                )
                print(
                    "Compose reports healthy. External TLS/auth, reboot, restore and voice acceptance remain required."
                )
            elif args.action == "backup":
                backup(c)
            elif args.action == "restore-check":
                if not args.encrypted_dump or not args.identity:
                    raise Refusal(
                        "Supply private encrypted dump and age identity file paths."
                    )
                restore(c, args.encrypted_dump, args.identity)
    except (Refusal, ValueError, OSError, subprocess.SubprocessError) as error:
        if isinstance(error, Refusal):
            print(f"Refused: {error}", file=sys.stderr)
        else:
            print(
                "Refused: invalid configuration or unavailable local dependency; inspect privately.",
                file=sys.stderr,
            )
        sys.exit(1)


if __name__ == "__main__":
    main()
