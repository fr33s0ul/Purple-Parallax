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

CHILDREN_PER_RING = 6

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


def multiline_label(text: str) -> str:
    label = text.strip()
    if "•" in label:
        label = re.sub(r"\s*•\s*", lambda _: "\n• ", label)
        label = label.replace("\n•  ", "\n• ")
    if ":" in label:
        label = re.sub(r":\s*", ":\n", label)
    if "/" in label:
        label = re.sub(r"\s*/\s*", "\n/", label)
        label = label.replace("\n/ ", "\n/")
    return label


def link_distance(depth: int) -> float:
    if depth <= 0:
        return 0.0
    if depth == 1:
        return 100.0
    if depth == 2:
        return 130.0
    return 130.0 + (depth - 2) * 20.0


def ring_multiplier(depth: int, rings: int) -> float:
    if depth <= 1:
        base = 1.3
    elif depth <= 3:
        base = 1.5
    else:
        base = 1.7
    extra = max(0, rings - 1) * 0.08
    return min(base + extra, base + 0.2)
def assign_positions(
    node: Dict,
    path: List[str],
    depth: int,
    radius: float,
    start_angle: float,
    end_angle: float,
    nodes: List[Dict],
    edges: List[Dict],
) -> None:
    node_id = path_id(path + [node["name"]])
    children = node.get("children") or []
    angle = (start_angle + end_angle) / 2
    nodes.append(
        {
            "id": node_id,
            "name": multiline_label(node["name"]),
            "x": round(radius * math.cos(angle), 3),
            "y": round(radius * math.sin(angle), 3),
            "depth": depth,
            "hasChildren": bool(children),
        }
    )
    if path:
        edges.append({"source": path_id(path), "target": node_id})
    if children:
        counts = [leaf_count(child) for child in children]
        total_leaves = sum(counts)
        span = end_angle - start_angle
        cursor = start_angle
        rings = max(1, math.ceil(len(children) / CHILDREN_PER_RING))
        base_distance = link_distance(depth + 1)
        max_multiplier = ring_multiplier(depth + 1, rings)
        extra_distance = base_distance * max(0.0, max_multiplier - 1.0)
        ring_spacing = extra_distance / (rings - 1) if rings > 1 else 0.0
        for index, child in enumerate(children):
            leaves = counts[index]
            child_span = span * leaves / total_leaves if total_leaves else span / len(children)
            child_start = cursor
            child_end = cursor + child_span
            ring_index = index // CHILDREN_PER_RING
            child_radius = radius + base_distance + ring_index * ring_spacing
            assign_positions(
                child,
                path + [node["name"]],
                depth + 1,
                child_radius,
                child_start,
                child_end,
                nodes,
                edges,
            )
            cursor += child_span


def build_branch(node: Dict, parent_path: List[str]) -> Dict:
    nodes: List[Dict] = []
    edges: List[Dict] = []
    assign_positions(node, parent_path, 0, 0.0, 0.0, 2 * math.pi, nodes, edges)
    return {
        "rootId": path_id(parent_path + [node["name"]]),
        "nodes": nodes,
        "edges": edges,
    }


def main() -> None:
    master = json.loads(MASTER_PATH.read_text(encoding="utf-8"))
    root_nodes: List[Dict] = []
    root_edges: List[Dict] = []
    children = master.get("children") or []
    counts = [leaf_count(child) for child in children]
    total_leaves = sum(counts)
    span = 2 * math.pi
    cursor = 0.0
    rings = max(1, math.ceil(len(children) / CHILDREN_PER_RING))
    base_distance = link_distance(1)
    max_multiplier = ring_multiplier(1, rings)
    extra_distance = base_distance * max(0.0, max_multiplier - 1.0)
    ring_spacing = extra_distance / (rings - 1) if rings > 1 else 0.0
    for index, child in enumerate(children):
        leaves = counts[index]
        child_span = span * leaves / total_leaves if total_leaves else span / len(children)
        child_start = cursor
        child_end = cursor + child_span
        branch_slug = slugify(child["name"])
        child_id = path_id([master["name"], child["name"]])
        ring_index = index // CHILDREN_PER_RING
        radius = base_distance + ring_index * ring_spacing
        angle = (child_start + child_end) / 2
        (DATA_DIR / f"branch-{branch_slug}.json").write_text(
            json.dumps(build_branch(child, [master["name"]]), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        root_nodes.append(
            {
                "id": child_id,
                "name": multiline_label(child["name"]),
                "x": round(radius * math.cos(angle), 3),
                "y": round(radius * math.sin(angle), 3),
                "depth": 1,
                "childUrl": f"data/branch-{branch_slug}.json",
                "hasChildren": bool(child.get("children")),
            }
        )
        root_edges.append({"source": path_id([master["name"]]), "target": child_id})
        cursor += child_span

    root_payload = {
        "root": {
            "id": path_id([master["name"]]),
            "name": multiline_label(master["name"]),
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
