import importlib.util
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("build_wrapper", ROOT / "tools" / "build_mgu.py")
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)


class BuildTest(unittest.TestCase):
    def test_sdk_free_package_and_store_collision_id(self):
        with tempfile.TemporaryDirectory(prefix="idrive-package-test-") as directory:
            root = Path(directory)
            shutil.copytree(ROOT / "apps", root / "apps")
            shutil.copytree(ROOT / "shared", root / "shared")
            for name in ("LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"):
                shutil.copyfile(ROOT / name, root / name)
            sdk = root / "oap-sdk"
            wrapper.ROOT = root
            wrapper.builder.ROOT = str(root)
            wrapper.builder.APPS = str(root / "apps")
            wrapper.builder.DIST = str(root / "dist")
            wrapper.builder.SDK = str(sdk)
            wrapper.build("oussem_youtube2", sdk_free=True)
            version = json.loads((root / "apps" / "oussem_youtube" / "app.json").read_text(encoding="utf-8"))["version"]
            archive = root / "dist" / f"oussem_youtube2@{version}.tgz"
            with tarfile.open(archive, "r:gz") as package:
                names = package.getnames()
                self.assertFalse(any("oap-sdk" in name for name in names))
                document = json.load(package.extractfile("package/package.json"))
                self.assertEqual(document["name"], "oussem_youtube2")
                self.assertTrue(document["mguInternet"])
                self.assertEqual(document["mguHmi"], ["ID7"])
                self.assertEqual(document["license"], "GPL-3.0-or-later")
                self.assertIn("package/javascript/safety.js", names)
                self.assertIn("package/rhmiData/uiDescriptions/ID7/application.xml", names)
                self.assertIn("package/javascript/kit/LICENSE", names)
            self.assertFalse((root / "apps" / "oussem_youtube2").exists())
            self.assertFalse((root / "apps" / "oussem_youtube" / "safety.js").exists())


if __name__ == "__main__":
    unittest.main()
