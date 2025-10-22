"""Copy static assets into docs/ for GitHub Pages hosting."""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
DATA_DIR = ROOT / "data"


def copy_tree(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def main() -> None:
    DOCS_DIR.mkdir(exist_ok=True)
    copy_tree(DATA_DIR, DOCS_DIR / "data")
    print(f"Data copied to {DOCS_DIR / 'data'}/")


if __name__ == "__main__":
    main()
