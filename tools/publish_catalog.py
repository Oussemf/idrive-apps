#!/usr/bin/env python3
"""Publish the derived app and the unmodified upstream service in a Store catalog."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
app = json.loads((root / "apps" / "oussem_youtube" / "app.json").read_text(encoding="utf-8"))
repo = json.loads((root / "mgu-repo.json").read_text(encoding="utf-8"))
service = json.loads((root / "store" / "jap-ridetube-d" / "component.json").read_text(encoding="utf-8"))
package = root / "dist" / f"oussem_youtube@{app['version']}.tgz"
service_url = "https://github.com/JustAnotherPU/ridetube/releases/download/catalog/jap-ridetube-d@0.3.9.tgz"
catalog = {"schema": 2, "components": [
    {"id": app["id"], "version": app["version"], "kind": "app", "title": "YouTube",
     "description": app["description"], "mguHmi": ["ID7"], "uninstallable": True,
     "requires": repo["apps"]["requires"],
     "artifact": {"name": package.name, "size": package.stat().st_size,
                  "sha256": hashlib.sha256(package.read_bytes()).hexdigest(),
                  "url": f"https://github.com/Oussemf/idrive-apps/releases/download/youtube-{app['version']}/{package.name}"}},
    {"id": service["id"], "version": service["version"], "kind": "tool", "title": "YouTube service",
     "description": repo["tools"][0]["description"], "mguHmi": ["ID7"], "uninstallable": True,
     "requires": repo["tools"][0]["requires"],
     "artifact": {"name": "jap-ridetube-d@0.3.9.tgz", "size": 8777546,
                  "sha256": "63dc4d7deb18849662d7d90efb41017483db5f835e6124fb90e6f5cd45300f5d",
                  "url": service_url}}
]}
(root / "dist" / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
