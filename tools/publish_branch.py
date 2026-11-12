#!/usr/bin/env python3
"""Stage the tested native tool for the Store's GitHub branch reader."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    component = json.loads((ROOT / "native/oussem-browser/component.json").read_text())
    target = ROOT / "store" / component["id"]
    if target.exists():
        raise SystemExit("Branch payload already exists; explicitly replace it for a new version")
    archive_path = ROOT / "dist" / f"{component['id']}@{component['version']}.tgz"
    with tarfile.open(archive_path) as archive:
        manifest = json.load(archive.extractfile("component.json"))
        for entry in manifest["files"]:
            relative = Path(entry["path"])
            if relative.is_absolute() or ".." in relative.parts:
                raise SystemExit("Unsafe tool manifest path")
            member = archive.getmember("files/" + entry["path"])
            if not member.isfile() or member.size >= 100 * 1024**2:
                raise SystemExit("Payload must be regular files below GitHub's 100 MiB limit")
            destination = target / "files" / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, destination.open("wb") as output:
                shutil.copyfileobj(source, output)
            if hashlib.file_digest(destination.open("rb"), "sha256").hexdigest() != entry["sha256"]:
                raise SystemExit("Tool payload checksum mismatch: " + entry["path"])
            entry["from"] = "files/" + entry["path"]
        (target / "component.json").write_text(json.dumps(manifest, indent=2) + "\n")
    repo_path = ROOT / "mgu-repo.json"
    repo = json.loads(repo_path.read_text())
    repo["tools"] = [{"id": component["id"], "path": "store/" + component["id"],
                      "uninstallable": True}]
    repo_path.write_text(json.dumps(repo, indent=2) + "\n")
    count = sum(1 for file in target.rglob("*") if file.is_file())
    if count > 400:
        raise SystemExit(f"Tool exceeds Store's partial-source download limit: {count} files")
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    total = sum((ROOT / name).stat().st_size for name in tracked if name and (ROOT / name).is_file()
                and not name.startswith("store/"))
    payload = sum(file.stat().st_size for file in target.rglob("*") if file.is_file())
    # Public branch installs read only this component's paths (sources.partPaths),
    # not the whole repo. Include tar headers/padding in its extraction budget.
    if payload + count * 1024 + 1024 >= 200 * 1024**2:
        raise SystemExit(f"Component exceeds Store's 200 MiB extraction limit: {payload}")
    print(f"Branch payload validated; {count} files; component {payload / 1024**2:.1f} MiB;"
          f" whole repo {(total + payload) / 1024**2:.1f} MiB (partial-source reader required)")


if __name__ == "__main__":
    main()
