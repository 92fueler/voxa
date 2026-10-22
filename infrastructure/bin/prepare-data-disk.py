#!/usr/bin/env python3
"""Mount an already formatted, explicitly reviewed ext4 disk. NEVER formats a disk."""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--uuid", required=True)
    p.add_argument("--execute", action="store_true")
    a = p.parse_args()
    if not re.fullmatch(
        r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", a.uuid
    ):
        raise ValueError(
            "Use the filesystem UUID verified against the AWS disk attachment."
        )
    device = Path("/dev/disk/by-uuid") / a.uuid
    if not device.exists() or not device.resolve().is_block_device():
        raise ValueError("Reviewed UUID is not an attached block filesystem.")
    fs = subprocess.run(
        ["blkid", "-o", "value", "-s", "TYPE", str(device)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if fs != "ext4":
        raise ValueError(
            "Only existing ext4 is supported. New empty disks require separate operator formatting approval."
        )
    target = Path("/srv/voxa")
    uses = subprocess.run(
        ["findmnt", "--json", "--source", f"UUID={a.uuid}", "--output", "TARGET"],
        check=False,
        capture_output=True,
        text=True,
    )
    if uses.returncode not in (0, 1):
        raise ValueError("Cannot verify existing device mounts.")
    if uses.returncode == 0 and any(
        mount.get("target") != str(target)
        for mount in json.loads(uses.stdout).get("filesystems", [])
    ):
        raise ValueError(
            "Reviewed device is mounted elsewhere; never reuse a root or another application's disk."
        )
    fstab = Path("/etc/fstab")
    if fstab.is_symlink():
        raise ValueError("Refusing symlinked fstab.")
    original = fstab.read_text()
    entry = f"UUID={a.uuid} /srv/voxa ext4 defaults,nodev,nosuid 0 2"
    existing = [
        line.split()
        for line in original.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    matching = [
        fields
        for fields in existing
        if len(fields) >= 2
        and (fields[0] == f"UUID={a.uuid}" or fields[1] == "/srv/voxa")
    ]
    if matching and (len(matching) != 1 or matching[0] != entry.split()):
        raise ValueError(
            "Conflicting existing fstab entry. Review manually; no overwrite."
        )
    mounted = subprocess.run(
        ["findmnt", "-n", "--mountpoint", str(target), "-o", "UUID"],
        check=False,
        capture_output=True,
        text=True,
    )
    if mounted.returncode == 0 and mounted.stdout.strip().lower() != a.uuid.lower():
        raise ValueError("Another filesystem occupies /srv/voxa.")
    if target.is_symlink():
        raise ValueError("Refusing symlinked mount directory.")
    if mounted.returncode != 0 and target.exists() and any(target.iterdir()):
        raise ValueError("Mount directory is nonempty; do not hide root-disk data.")
    if not a.execute:
        print("Verified existing ext4 device. Proposed fstab entry (no changes):")
        print(entry)
        return
    if os.geteuid() != 0:
        raise ValueError("Approved host storage setup requires root.")
    if not matching:
        # Keep an exclusive original backup. Refuse ambiguous recovery from earlier partial setup.
        backup = Path("/etc/fstab.before-voxa")
        with backup.open("x") as out:
            out.write(original)
        shutil.copystat(fstab, backup)
        fd, tmp = tempfile.mkstemp(prefix=".fstab-voxa-", dir="/etc")
        try:
            with os.fdopen(fd, "w") as out:
                out.write(original.rstrip() + "\n" + entry + "\n")
                out.flush()
                os.fsync(out.fileno())
            shutil.copystat(fstab, tmp)
            os.replace(tmp, fstab)
        finally:
            if Path(tmp).exists():
                Path(tmp).unlink()
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    if mounted.returncode != 0:
        subprocess.run(["mount", str(target)], check=True)
    for name in ("postgres", "caddy-data", "caddy-config", "backups"):
        d = target / name
        if d.is_symlink():
            raise ValueError("Refusing symlinked data subdirectory.")
        d.mkdir(mode=0o700, exist_ok=True)
    print(
        "Mounted reviewed filesystem; no formatting performed. Install Docker mount dependency and run storage-check before starting containers."
    )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as e:
        print(f"Refused storage setup: {e}", file=sys.stderr)
        sys.exit(1)
