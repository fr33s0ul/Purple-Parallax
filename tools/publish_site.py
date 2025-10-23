"""Copy static assets into docs/ for GitHub Pages hosting."""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
SOURCE_HTML = ROOT / "CyberAtlas.html"
DATA_DIR = ROOT / "data"


def copy_tree(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def main() -> None:
    DOCS_DIR.mkdir(exist_ok=True)
    shutil.copy2(SOURCE_HTML, DOCS_DIR / "index.html")
    copy_tree(DATA_DIR, DOCS_DIR / "data")
    print(f"Site copied to {DOCS_DIR}/")


if __name__ == "__main__":
    main()
