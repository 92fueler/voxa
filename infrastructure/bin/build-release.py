#!/usr/bin/env python3
"""Build a clean reviewed HEAD into local transferable archives; never pushes images."""

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--revision", required=True, help="Exact reviewed 40-character HEAD SHA"
    )
    p.add_argument(
        "--postgres-image",
        required=True,
        help="Preloaded reviewed pgvector repository@sha256:digest",
    )
    p.add_argument(
        "--output", type=Path, required=True, help="New directory outside source tree"
    )
    a = p.parse_args()
    import re

    if not re.fullmatch(r"[0-9a-f]{40}", a.revision):
        p.error("Require an exact reviewed commit SHA.")
    if (
        run(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        != a.revision
    ):
        p.error("Revision must match HEAD; use a separate clean checkout.")
    if run(
        ["git", "-C", str(ROOT), "status", "--porcelain"], capture_output=True
    ).stdout.strip():
        p.error(
            "Uncommitted or untracked files exist. Review them before selecting a release."
        )
    if ROOT == a.output.resolve() or ROOT in a.output.resolve().parents:
        p.error("Keep the output outside the source checkout.")
    if not re.fullmatch(r"[a-zA-Z0-9._:/-]+@sha256:[0-9a-f]{64}", a.postgres_image):
        p.error("Require a reviewed PostgreSQL digest, not a mutable tag.")
    info = json.loads(
        run(
            [
                "docker",
                "image",
                "inspect",
                "--platform",
                "linux/amd64",
                a.postgres_image,
            ],
            capture_output=True,
        ).stdout
    )
    if len(info) != 1 or info[0]["Architecture"] != "amd64" or info[0]["Os"] != "linux":
        p.error("Preload the reviewed linux/amd64 PostgreSQL image.")
    a.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    images = {"postgres_image": a.postgres_image}
    with tempfile.TemporaryDirectory() as d:
        for component in ("backend", "web-client"):
            iid = Path(d) / component
            run(
                [
                    "docker",
                    "build",
                    "--platform",
                    "linux/amd64",
                    "--iidfile",
                    str(iid),
                    "-f",
                    str(ROOT / component / "Dockerfile"),
                    str(ROOT),
                ]
            )
            images["web_image" if component == "web-client" else "backend_image"] = (
                iid.read_text().strip()
            )
    run(
        [
            "docker",
            "save",
            "--platform",
            "linux/amd64",
            "--output",
            str(a.output / "images.tar"),
            *images.values(),
        ]
    )
    run(
        [
            "git",
            "-C",
            str(ROOT),
            "archive",
            "--format=tar",
            "--output",
            str(a.output / "source.tar"),
            a.revision,
        ]
    )
    template = json.loads((ROOT / "infrastructure/operations.example.json").read_text())
    template.update(images)
    (a.output / "operations.example.json").write_text(
        json.dumps(template, indent=2) + "\n"
    )
    manifest = {"revision": a.revision, **images, "sha256": {}, "source_hashes": {}}
    tracked = run(
        ["git", "-C", str(ROOT), "ls-files", "-z"], capture_output=True
    ).stdout
    for name in tracked.decode().split("\0"):
        if name:
            manifest["source_hashes"][name] = hashlib.sha256(
                (ROOT / name).read_bytes()
            ).hexdigest()
    for name in ("images.tar", "source.tar", "operations.example.json"):
        with (a.output / name).open("rb") as f:
            manifest["sha256"][name] = hashlib.file_digest(f, "sha256").hexdigest()
    (a.output / "release.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(
        "Local release archives prepared. No registry push, remote copy, or deployment performed."
    )


if __name__ == "__main__":
    main()
