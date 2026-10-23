"""Run a copied macOS plugin when the installer omitted venv symlinks."""
import runpy
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = f"python{sys.version_info.major}.{sys.version_info.minor}"
packages = root / ".venv" / "lib" / version / "site-packages"
if sys.version_info < (3, 9) or not (packages / "psutil").is_dir():
    raise RuntimeError("Prepare the plugin dependencies using this Python version.")
# Do not execute .pth files or use user site/PYTHONPATH. -I isolates the interpreter.
sys.path[:0] = [str(root / "agent"), str(packages)]
runpy.run_path(str(root / "agent" / "worker.py"), run_name="__main__")
