import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("source_package", Path(__file__).resolve().parents[1] / "scripts/package.py")
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class SourceArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project"
        self.root.mkdir()
        for name, data in {
            "LICENSE": "MIT", "README.md": "Public documentation",
            "package.json": json.dumps({"version": "0.1.4"}),
            "plugin.json": json.dumps({"version": "0.1.4"}),
            "agent/core.py": "# reviewed source",
        }.items():
            self.write(name, data)

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def test_local_data_and_environments_are_not_archived(self):
        for name in [".env", ".env.production", "artifacts/live-scan.json",
                     "artifacts/private.py", "node_modules/local.js",
                     ".venv/lib/private.py", "scripts/.env", "server/local.key",
                     "public/screenshot.png", "local.sqlite", "dist/old.zip"]:
            self.write(name, "private fixture")
        target = Path(self.temp.name) / "release.zip"
        package.build_archive(self.root, target)
        with ZipFile(target) as archive:
            self.assertEqual(set(archive.namelist()), {
                "computer-load-chatgpt/LICENSE", "computer-load-chatgpt/README.md",
                "computer-load-chatgpt/package.json", "computer-load-chatgpt/plugin.json",
                "computer-load-chatgpt/agent/core.py",
            })

    def test_symlink_to_external_file_is_rejected(self):
        outside = Path(self.temp.name) / "private.py"
        outside.write_text("private fixture")
        link = self.root / "agent/leak.py"
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("Symlink creation is not permitted on this host")
        with self.assertRaises(ValueError):
            package.build_archive(self.root, Path(self.temp.name) / "release.zip")

    def test_missing_license_and_mismatched_versions_are_rejected(self):
        (self.root / "LICENSE").unlink()
        with self.assertRaises(ValueError):
            package.build_archive(self.root, Path(self.temp.name) / "release.zip")
        self.write("LICENSE", "MIT")
        self.write("plugin.json", json.dumps({"version": "0.1.3"}))
        with self.assertRaises(ValueError):
            package.build_archive(self.root, Path(self.temp.name) / "release.zip")


if __name__ == "__main__":
    unittest.main()
