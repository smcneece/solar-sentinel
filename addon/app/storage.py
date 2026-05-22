"""JSON persistence for Solar Sentinel.

Data lives in a single file with two top-level keys:
  layout   -- user-defined panel labels; keyed by entity_id
  settings -- global settings

Single-process add-on: no locking needed."""

import json
import logging
import os

_LOGGER = logging.getLogger(__name__)

DATA_FILE = "/data/solar_sentinel.json"

DEFAULT_SETTINGS = {
    "refresh_interval": 300,
    "min_avg_w": 5,
}


def _load() -> dict:
    if not os.path.exists(DATA_FILE):
        return {"layout": {}, "settings": {}}
    try:
        with open(DATA_FILE) as f:
            data = json.load(f)
        data.setdefault("layout", {})
        data.setdefault("settings", {})
        return data
    except Exception:
        _LOGGER.exception("Failed to load data file, starting fresh")
        return {"layout": {}, "settings": {}}


def _save(data: dict):
    try:
        with open(DATA_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception:
        _LOGGER.exception("Failed to save data file")


def get_settings() -> dict:
    stored = _load().get("settings", {})
    return {**DEFAULT_SETTINGS, **stored}


def save_settings(updates: dict) -> dict:
    data = _load()
    current = {**DEFAULT_SETTINGS, **data.get("settings", {})}
    allowed = {"refresh_interval", "min_avg_w"}
    for key in allowed:
        if key in updates:
            current[key] = updates[key]
    data["settings"] = current
    _save(data)
    return current


def get_layout() -> dict:
    """Returns dict of entity_id -> custom_label (empty string means use auto-generated name)."""
    return _load().get("layout", {})


def save_layout(layout: dict) -> dict:
    """Persist the layout dict (entity_id -> label). Replaces existing layout entirely."""
    data = _load()
    data["layout"] = {str(k): str(v) for k, v in layout.items()}
    _save(data)
    return data["layout"]


def get_grid() -> dict:
    """Returns grid config: {rows, cols, positions: {entity_id: [row, col]}}."""
    raw = _load().get("grid", {})
    return {
        "rows": int(raw.get("rows", 4)),
        "cols": int(raw.get("cols", 16)),
        "positions": raw.get("positions", {}),
    }


def save_grid(update: dict) -> dict:
    data = _load()
    existing = data.get("grid", {})
    result = {
        "rows": max(1, int(update.get("rows", existing.get("rows", 4)))),
        "cols": max(1, int(update.get("cols", existing.get("cols", 16)))),
        "positions": update.get("positions", existing.get("positions", {})),
    }
    data["grid"] = result
    _save(data)
    return result
