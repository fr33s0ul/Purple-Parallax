"""Generate precomputed layouts for the Cybersecurity Atlas graph.

This script ingests the master taxonomy JSON and emits:
* data/root.json          – coordinates for the root node and top-level groups
* data/branch-*.json      – per-branch layouts containing all descendant nodes

The radial positions are computed once using a lightweight polar tree layout so
that the runtime client simply reads co-ordinates without running a physics
simulation. The goal is to keep initial load times low and avoid layout thrash
on under-powered devices.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Dict, Iterable, List

RADIUS_STEP = 160
ROOT_RADIUS = 320

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
MASTER_PATH = DATA_DIR / "master.json"


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower())
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "node"


def path_id(path: Iterable[str]) -> str:
    return "-".join(slugify(segment) for segment in path)


def leaf_count(node: Dict) -> int:
    children = node.get("children") or []
    if not children:
        return 1
    return sum(leaf_count(child) for child in children)


def assign_positions(
    node: Dict,
    path: List[str],
    depth: int,
    start_angle: float,
    end_angle: float,
    nodes: List[Dict],
    edges: List[Dict],
) -> None:
    node_id = path_id(path + [node["name"]])
    children = node.get("children") or []
    radius = 0 if depth == 0 else depth * RADIUS_STEP
    angle = (start_angle + end_angle) / 2
    nodes.append(
        {
            "id": node_id,
            "name": node["name"],
            "x": round(radius * math.cos(angle), 3),
            "y": round(radius * math.sin(angle), 3),
            "depth": depth,
            "hasChildren": bool(children),
        }
    )
    if path:
        edges.append({"source": path_id(path), "target": node_id})
    if children:
        total_leaves = sum(leaf_count(child) for child in children)
        span = end_angle - start_angle
        cursor = start_angle
        for child in children:
            leaves = leaf_count(child)
            child_span = span * leaves / total_leaves if total_leaves else span / len(children)
            assign_positions(child, path + [node["name"]], depth + 1, cursor, cursor + child_span, nodes, edges)
            cursor += child_span


def build_branch(node: Dict, parent_path: List[str]) -> Dict:
    nodes: List[Dict] = []
    edges: List[Dict] = []
    assign_positions(node, parent_path, 0, 0.0, 2 * math.pi, nodes, edges)
    return {
        "rootId": path_id(parent_path + [node["name"]]),
        "nodes": nodes,
        "edges": edges,
    }


def main() -> None:
    master = json.loads(MASTER_PATH.read_text(encoding="utf-8"))
    root_nodes: List[Dict] = []
    root_edges: List[Dict] = []
    for index, child in enumerate(master["children"]):
        angle = 2 * math.pi * index / len(master["children"])
        child_id = path_id([master["name"], child["name"]])
        branch_slug = slugify(child["name"])
        (DATA_DIR / f"branch-{branch_slug}.json").write_text(
            json.dumps(build_branch(child, [master["name"]]), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        root_nodes.append(
            {
                "id": child_id,
                "name": child["name"],
                "x": round(ROOT_RADIUS * math.cos(angle), 3),
                "y": round(ROOT_RADIUS * math.sin(angle), 3),
                "depth": 1,
                "childUrl": f"data/branch-{branch_slug}.json",
                "hasChildren": bool(child.get("children")),
            }
        )
        root_edges.append({"source": path_id([master["name"]]), "target": child_id})

    root_payload = {
        "root": {
            "id": path_id([master["name"]]),
            "name": master["name"],
            "x": 0,
            "y": 0,
            "depth": 0,
            "hasChildren": True,
        },
        "children": root_nodes,
        "edges": root_edges,
    }
    (DATA_DIR / "root.json").write_text(json.dumps(root_payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
