#!/usr/bin/env python3
"""Build OAP packages without redistributing the BMW SDK."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tarfile

ROOT = Path(__file__).resolve().parent.parent
KIT = ROOT / "vendor" / "mgu-kit"
sys.path.insert(0, str(KIT / "kit" / "tools"))
spec = importlib.util.spec_from_file_location("mgu_build", KIT / "kit" / "tools" / "build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
builder.ROOT = str(ROOT)
builder.APPS = str(ROOT / "apps")
builder.DIST = str(ROOT / "dist")
builder.SDK = str(ROOT / "oap-sdk")


def build(app_id, preview=False, sdk_free=False):
    source = ROOT / "apps" / "oussem_youtube"
    if not app_id.replace("_", "").isalnum() or not app_id.startswith("oussem_youtube"):
        raise SystemExit("Unsupported app id")
    # Store may allocate a suffixed id to avoid another source's installed app.
    if app_id != "oussem_youtube":
        source = ROOT / "apps" / app_id
        if source.exists():
            raise SystemExit("Refusing to overwrite an existing app directory")
        shutil.copytree(ROOT / "apps" / "oussem_youtube", source)
        document = json.loads((source / "app.json").read_text(encoding="utf-8"))
        document["id"] = app_id
        (source / "app.json").write_text(json.dumps(document, indent=2), encoding="utf-8")
    safety_target = source / "safety.js"
    if safety_target.exists():
        raise SystemExit("Generated safety.js already exists; refusing to overwrite it")
    try:
        shutil.copyfile(ROOT / "shared" / "safety.js", safety_target)
        builder.build(app_id, preview_only=preview, sdk_free=sdk_free)
        stage = ROOT / "dist" / app_id
        package = stage / "source" / "package.json"
        document = json.loads(package.read_text(encoding="utf-8"))
        document.update({"license": "GPL-3.0-or-later", "mguInternet": True, "mguHmi": ["ID7"]})
        package.write_text(json.dumps(document, indent=2), encoding="utf-8")
        shutil.copyfile(ROOT / "THIRD_PARTY_NOTICES.md", stage / "source" / "THIRD_PARTY_NOTICES.md")
        shutil.copyfile(ROOT / "LICENSE", stage / "source" / "LICENSE")
        shutil.copyfile(ROOT / "NOTICE", stage / "source" / "NOTICE")
        shutil.copyfile(KIT / "LICENSE", stage / "source" / "javascript" / "kit" / "LICENSE")
        if not preview:
            # The Store supplies the SDK on the unit. It must never enter a public artifact.
            shutil.rmtree(stage / "source" / "node_modules" / "oap-sdk")
            version = document["version"]
            for suffix in ("mgu", "tgz"):
                archive = ROOT / "dist" / f"{app_id}@{version}.{suffix}"
                with builder.gz_header_free(str(archive)) as gz, tarfile.open(fileobj=gz, mode="w") as tf:
                    if suffix == "tgz":
                        tf.add(stage / "source", arcname="package")
                    else:
                        for item in ("meta.json", "source", "rhmiData", "oapgen"):
                            tf.add(stage / item, arcname=item)
            print("SDK-free archives rebuilt; internet enabled; ID7 only.")
    finally:
        safety_target.unlink(missing_ok=True)
        if app_id != "oussem_youtube":
            shutil.rmtree(source)


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "oussem_youtube", "--preview-only" in sys.argv,
          "--sdk-free" in sys.argv)
