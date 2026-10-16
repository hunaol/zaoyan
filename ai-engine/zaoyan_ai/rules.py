"""Validated business calibration. JSON keys intentionally match Java/React."""
from __future__ import annotations
import json
import copy
import math
from pathlib import Path

DEFAULTS = {
    "schemaVersion": 1, "roiX1": 0., "roiY1": 0., "roiX2": 1., "roiY2": 1.,
    "confidence": .35, "reviewConfidence": .65, "deadzone": .012,
    "stableFrames": 2, "maxGapSeconds": 2.5,
    "duplicateWindowSeconds": 1.5, "duplicateDistance": .08,
    "nestingPolicy": "OUTER",
    "targetLabels": ["tray", "plate", "lunchbox", "mealbox", "meal box", "food box", "bowl"],
    "emptyLabels": ["empty_tray", "empty_box"],
}


def parse_rules(value: dict | None = None) -> dict:
    if value is not None and not isinstance(value, dict):
        raise ValueError("rules must be a JSON object")
    r = copy.deepcopy({**DEFAULTS, **(value or {})})
    if r["schemaVersion"] != 1:
        raise ValueError("unsupported counting rules version")
    bounds = {
        "roiX1": (0, 1), "roiY1": (0, 1), "roiX2": (0, 1), "roiY2": (0, 1),
        "confidence": (.05, .95), "reviewConfidence": (.05, 1), "deadzone": (.001, .1),
        "stableFrames": (1, 15), "maxGapSeconds": (.1, 30),
        "duplicateWindowSeconds": (0, 10), "duplicateDistance": (0, .3),
    }
    for key, (low, high) in bounds.items():
        n = r[key]
        if isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or not low <= n <= high:
            raise ValueError("invalid rule: " + key)
    if int(r["stableFrames"]) != r["stableFrames"]:
        raise ValueError("stableFrames must be an integer")
    if r["roiX2"] - r["roiX1"] < .1 or r["roiY2"] - r["roiY1"] < .1:
        raise ValueError("ROI is too small")
    if r["reviewConfidence"] < r["confidence"] or r["nestingPolicy"] not in ("OUTER", "INNER"):
        raise ValueError("invalid confidence/nesting policy")
    for key in ("targetLabels", "emptyLabels"):
        labels = r[key]
        if not isinstance(labels, list) or len(labels) > 30 or (key == "targetLabels" and not labels):
            raise ValueError("invalid labels")
        if any(not isinstance(s, str) or not s.strip() or len(s) > 50 or s != s.strip().lower() for s in labels):
            raise ValueError("labels must be nonempty lowercase strings")
        if len(set(labels)) != len(labels):
            raise ValueError("duplicate class labels")
    if set(r["targetLabels"]) & set(r["emptyLabels"]):
        raise ValueError("targetLabels and emptyLabels overlap")
    return r


def load_rules(filename: str | None) -> dict:
    return parse_rules(json.loads(Path(filename).read_text(encoding="utf-8")) if filename else None)
