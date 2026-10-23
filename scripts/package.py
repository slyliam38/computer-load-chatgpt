"""Build a source archive from reviewed paths, excluding local data and runtimes."""
import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT_FILES = (
    ".gitattributes", ".gitignore", "README.md", "README.ru.md", "VALIDATION.md",
    "LICENSE", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md",
    "THIRD_PARTY_NOTICES.md", "package.json", "package-lock.json", "plugin.json",
    "mcp.json", "requirements.txt", "Start-macOS.command", "Start-Windows.cmd",
    ".agents/plugins/marketplace.json",
)
SOURCE_DIRS = {
    "agent": {".py"}, "server": {".mjs"}, "public": {".html", ".mjs"},
    "scripts": {".py", ".mjs"}, "tests": {".py", ".mjs"},
    "skills": {".md"}, ".github/workflows": {".yml", ".yaml"},
}


def public_files(root):
    root = Path(root).resolve()
    selected = [root / name for name in ROOT_FILES if (root / name).exists()]
    for directory, extensions in SOURCE_DIRS.items():
        folder = root / directory
        if folder.is_symlink():
            raise ValueError("Release source directories must not be symlinks")
        if folder.exists():
            selected.extend(p for p in folder.rglob("*")
                            if p.suffix in extensions and not p.name.startswith(".")
                            and "__pycache__" not in p.parts)
    files = []
    for path in sorted(set(selected)):
        if path.is_symlink():
            raise ValueError("Release files must not be symlinks")
        path.resolve().relative_to(root)
        if path.is_file():
            files.append(path)
    return files


def build_archive(root, target):
    root, target = Path(root).resolve(), Path(target)
    for required in ("LICENSE", "README.md", "package.json", "plugin.json"):
        if not (root / required).is_file():
            raise ValueError("Missing required release file: " + required)
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    plugin = json.loads((root / "plugin.json").read_text(encoding="utf-8"))
    if package["version"] != plugin["version"]:
        raise ValueError("Package and plugin versions differ")
    files = public_files(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, Path("computer-load-chatgpt") / path.relative_to(root))
    return target


def main():
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=root / "dist" / f"computer-load-chatgpt-{version}.zip")
    args = parser.parse_args()
    print(build_archive(root, args.output))


if __name__ == "__main__":
    main()
