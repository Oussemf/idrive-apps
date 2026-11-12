#!/usr/bin/env python3
"""Write a schema-2 MGU Store catalog for the verified release artifacts."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist"
TAG = "browser-0.1.0"
BASE = "https://github.com/Oussemf/idrive-apps/releases/download/" + TAG + "/"


def artifact(name):
    file = OUT / name
    return {"name": name, "size": file.stat().st_size,
            "sha256": hashlib.sha256(file.read_bytes()).hexdigest(), "url": BASE + name}


app = json.loads((ROOT / "apps" / "oussem_youtube" / "app.json").read_text())
tool = json.loads((ROOT / "native" / "oussem-browser" / "component.json").read_text())
catalog = {"schema": 2, "components": [
    {"id": tool["id"], "version": tool["version"], "kind": "tool", "title": tool["title"],
     "description": tool["description"], "mguHmi": ["ID7"], "uninstallable": True,
     "optional": True, "requires": tool["requires"],
     "artifact": artifact(f"{tool['id']}@{tool['version']}.tgz")},
    {"id": app["id"], "version": app["version"], "kind": "app", "title": app["title"],
     "description": "YouTube client with automatically detected browser companion (experimental).",
     "mguHmi": ["ID7"], "uninstallable": True,
     "requires": {"oussem-browser": tool["version"]},
     "artifact": artifact(f"{app['id']}@{app['version']}.tgz")}
]}
(OUT / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")
