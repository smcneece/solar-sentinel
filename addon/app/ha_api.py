"""HA data fetchers for Solar Sentinel.

All HA communication lives here: Energy Dashboard discovery, entity states,
WebSocket registry queries, statistics (today Wh), and history (time slider)."""

import asyncio
import calendar
import datetime
import json
import logging
import zoneinfo
from urllib.parse import urlencode

import aiohttp

from ha_config import HA_API_URL, _HA_WS_URL, _headers, _token

_LOGGER = logging.getLogger(__name__)


# ── Basic HA config ─────────────────────────────────────────────────────

async def get_ha_config() -> dict:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{HA_API_URL}/config",
                headers=_headers(),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                return await resp.json() if resp.status == 200 else {}
    except Exception:
        _LOGGER.exception("Failed to fetch HA config")
        return {}


async def get_ha_timezone() -> str:
    return (await get_ha_config()).get("time_zone", "")


async def get_ha_version() -> str:
    return (await get_ha_config()).get("version", "")


# ── Energy Dashboard discovery ───────────────────────────────────────────

async def get_energy_config() -> dict:
    """Fetch HA Energy Dashboard preferences via WebSocket (energy/get_prefs).
    Using WebSocket because the REST energy endpoint is not reliably exposed
    through the Supervisor proxy."""
    token = _token()
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(
                _HA_WS_URL, timeout=aiohttp.ClientTimeout(total=15)
            ) as ws:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_required":
                    return {}
                await ws.send_json({"type": "auth", "access_token": token})
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_ok":
                    _LOGGER.warning("WebSocket auth failed for energy config")
                    return {}
                await ws.send_json({"id": 1, "type": "energy/get_prefs"})
                msg = await asyncio.wait_for(ws.receive_json(), timeout=10)
                if not msg.get("success"):
                    _LOGGER.warning("energy/get_prefs failed: %s", msg.get("error"))
                    return {}
                return msg.get("result", {})
    except Exception:
        _LOGGER.exception("Failed to fetch energy config")
        return {}


async def get_entity_registry() -> list:
    """Fetch the full entity registry via WebSocket. Returns list of registry entries."""
    token = _token()
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(
                _HA_WS_URL, timeout=aiohttp.ClientTimeout(total=15)
            ) as ws:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_required":
                    return []
                await ws.send_json({"type": "auth", "access_token": token})
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_ok":
                    _LOGGER.warning("WebSocket auth failed for entity registry")
                    return []
                await ws.send_json({"id": 1, "type": "config/entity_registry/list"})
                msg = await asyncio.wait_for(ws.receive_json(), timeout=15)
                return msg.get("result") or []
    except Exception:
        _LOGGER.exception("Failed to fetch entity registry")
        return []


async def get_entity_states_batch(entity_ids: list) -> dict:
    """Fetch current states for a list of entity_ids. Returns dict of entity_id -> state."""
    if not entity_ids:
        return {}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{HA_API_URL}/states",
                headers=_headers(),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status != 200:
                    return {}
                all_states = await resp.json()
        wanted = set(entity_ids)
        return {s["entity_id"]: s for s in all_states if s["entity_id"] in wanted}
    except Exception:
        _LOGGER.exception("Failed to fetch entity states")
        return {}


async def get_moon_state() -> str:
    """Fetch moon phase from sensor.moon or sensor.moon_phase. Returns phase string or empty string."""
    for eid in ("sensor.moon_phase", "sensor.moon"):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{HA_API_URL}/states/{eid}",
                    headers=_headers(),
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 200:
                        state = (await resp.json()).get("state", "")
                        if state and state not in ("unknown", "unavailable"):
                            _LOGGER.debug("Moon phase from %s: %s", eid, state)
                            return state
        except Exception:
            pass
    return ""


async def get_sun_state() -> dict:
    """Fetch sun.sun entity state and attributes."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{HA_API_URL}/states/sun.sun",
                headers=_headers(),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                return {}
    except Exception:
        _LOGGER.exception("Failed to fetch sun.sun state")
        return {}


# ── Inverter discovery ───────────────────────────────────────────────────

async def discover_solar_inverters() -> list:
    """Discover per-inverter power sensors via the Energy Dashboard and entity registry.

    Returns list of dicts:
      entity_id, name, device_id, power_unit, energy_entity_id, energy_unit

    Strategy (device-centric, avoids pulling in shared-integration non-panel entities):
      1. Energy config -> stat_energy_from entity_ids (one per panel in Energy Dashboard)
      2. Entity registry -> map each energy entity to its device_id
      3. For each device, find the best power sensor (non-MPPT, device_class=power, unit W or kW)
      4. Energy entity and unit are already known from step 1
    """
    energy_config = await get_energy_config()
    solar_energy_ids = [
        src["stat_energy_from"]
        for src in energy_config.get("energy_sources", [])
        if src.get("type") == "solar" and src.get("stat_energy_from")
    ]

    if not solar_energy_ids:
        _LOGGER.warning("No solar sources in Energy Dashboard. Sources: %s",
                        energy_config.get("energy_sources", []))
        return []

    _LOGGER.info("Solar energy sensors from Energy Dashboard: %s", solar_energy_ids)

    registry = await get_entity_registry()
    registry_by_id = {e["entity_id"]: e for e in registry}

    # Group registry entries by device_id for fast per-device lookup
    by_device: dict = {}
    for e in registry:
        dev = e.get("device_id")
        if dev:
            by_device.setdefault(dev, []).append(e)

    # Map each energy sensor to its device; skip any with no device_id
    device_to_energy: dict = {}
    for eid in solar_energy_ids:
        dev = registry_by_id.get(eid, {}).get("device_id")
        if dev:
            device_to_energy[dev] = eid
        else:
            _LOGGER.warning("No device_id for energy sensor %s; skipping", eid)

    if not device_to_energy:
        _LOGGER.warning("Could not resolve any devices from energy sensors")
        return []

    _LOGGER.info("Mapped %d energy sensors to %d device(s)",
                 len(device_to_energy), len(device_to_energy))

    # Fetch states for all entities on these devices only
    target_devices = set(device_to_energy.keys())
    candidate_ids = [
        e["entity_id"] for e in registry if e.get("device_id") in target_devices
    ]
    _LOGGER.info("Candidate entity count: %d across %d device(s)",
                 len(candidate_ids), len(target_devices))
    states = await get_entity_states_batch(candidate_ids)

    result = []
    for device_id in target_devices:
        energy_eid = device_to_energy[device_id]
        device_entries = by_device.get(device_id, [])

        power_candidates = []
        energy_unit = None

        for entry in device_entries:
            eid = entry["entity_id"]
            state = states.get(eid, {})
            attrs = state.get("attributes", {})
            dc = attrs.get("device_class", "")
            unit = attrs.get("unit_of_measurement", "")

            if eid == energy_eid:
                energy_unit = unit if unit in ("Wh", "kWh") else None

            if dc == "power" and unit in ("W", "kW"):
                power_candidates.append({
                    "entity_id": eid,
                    "name": attrs.get("friendly_name", eid),
                    "power_unit": unit,
                    "device_id": device_id,
                    "is_mppt": "mppt" in eid.lower(),
                })

        if not power_candidates:
            _LOGGER.warning("No power sensor on device %s (energy: %s)", device_id, energy_eid)
            continue

        non_mppt = [c for c in power_candidates if not c["is_mppt"]]
        best = (non_mppt or power_candidates)[0]

        result.append({
            "entity_id": best["entity_id"],
            "name": best["name"],
            "power_unit": best["power_unit"],
            "device_id": device_id,
            "energy_entity_id": energy_eid,
            "energy_unit": energy_unit,
            "device_entity_ids": [e["entity_id"] for e in device_entries],
        })

    _LOGGER.info(
        "Discovered %d solar inverter(s) from %d energy source(s)",
        len(result), len(solar_energy_ids),
    )
    return sorted(result, key=lambda x: x["name"])


# ── Entity rename ────────────────────────────────────────────────────────

async def rename_entity(entity_id: str, name) -> bool:
    """Set or clear the user-friendly name on an entity via entity registry WebSocket.

    Pass name=None to revert to the integration-provided name."""
    token = _token()
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(
                _HA_WS_URL, timeout=aiohttp.ClientTimeout(total=15)
            ) as ws:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_required":
                    return False
                await ws.send_json({"type": "auth", "access_token": token})
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_ok":
                    _LOGGER.warning("WebSocket auth failed for entity rename")
                    return False
                await ws.send_json({
                    "id": 1,
                    "type": "config/entity_registry/update",
                    "entity_id": entity_id,
                    "name": name,
                })
                msg = await asyncio.wait_for(ws.receive_json(), timeout=10)
                if not msg.get("success"):
                    _LOGGER.warning("Entity rename failed for %s: %s",
                                    entity_id, msg.get("error"))
                    return False
                _LOGGER.info("Renamed %s to %r in HA entity registry", entity_id, name)
                return True
    except Exception:
        _LOGGER.exception("Failed to rename entity %s", entity_id)
        return False


# ── Today Wh via statistics ──────────────────────────────────────────────

async def get_today_wh(inverters: list, tz_name: str) -> dict:
    """Return today's energy production in Wh per inverter using HA statistics.

    Returns dict of energy_entity_id -> wh_float.
    Inverters with no energy sensor or no statistics data are omitted."""
    energy_pairs = [
        (inv["energy_entity_id"], inv["energy_unit"])
        for inv in inverters
        if inv.get("energy_entity_id")
    ]
    if not energy_pairs:
        return {}

    try:
        tz = zoneinfo.ZoneInfo(tz_name) if tz_name else datetime.timezone.utc
    except Exception:
        tz = datetime.timezone.utc

    now = datetime.datetime.now(tz)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_str = midnight.isoformat()
    end_str = now.isoformat()

    statistic_ids = [p[0] for p in energy_pairs]
    unit_map = {p[0]: p[1] for p in energy_pairs}

    token = _token()
    result = {}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(
                _HA_WS_URL, timeout=aiohttp.ClientTimeout(total=20)
            ) as ws:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_required":
                    return {}
                await ws.send_json({"type": "auth", "access_token": token})
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_ok":
                    return {}
                await ws.send_json({
                    "id": 1,
                    "type": "recorder/statistics_during_period",
                    "start_time": start_str,
                    "end_time": end_str,
                    "statistic_ids": statistic_ids,
                    "period": "day",
                    "types": ["change"],
                })
                msg = await asyncio.wait_for(ws.receive_json(), timeout=30)
                if not msg.get("success"):
                    _LOGGER.warning("Statistics query failed: %s", msg.get("error"))
                    return {}
                data = msg.get("result", {})

        for eid in statistic_ids:
            entries = data.get(eid, [])
            if entries:
                change = entries[0].get("change") or 0
                # Convert kWh to Wh if needed
                wh = change * 1000 if unit_map.get(eid) == "kWh" else change
                result[eid] = round(wh, 0)
    except Exception:
        _LOGGER.exception("Failed to fetch today Wh statistics")

    return result


# ── Per-entity statistics for the panel chart ────────────────────────────

async def get_entity_stats_for_chart(entity_id: str, start_utc: datetime.datetime,
                                     end_utc: datetime.datetime, period: str) -> list:
    """Fetch statistics for a single entity for the history chart.

    Returns list of {ts: unix_ms, w: float} with one entry per period bucket.
    period should be 'hour' (7d/30d/90d) or 'day' (6m/1y)."""
    token = _token()
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(
                _HA_WS_URL, timeout=aiohttp.ClientTimeout(total=30)
            ) as ws:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_required":
                    return []
                await ws.send_json({"type": "auth", "access_token": token})
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_ok":
                    return []
                await ws.send_json({
                    "id": 1,
                    "type": "recorder/statistics_during_period",
                    "start_time": start_utc.isoformat(),
                    "end_time": end_utc.isoformat(),
                    "statistic_ids": [entity_id],
                    "period": period,
                })
                msg = await asyncio.wait_for(ws.receive_json(), timeout=30)
                if not msg.get("success"):
                    _LOGGER.warning("Chart stats failed for %s: %s", entity_id, msg.get("error"))
                    return []
                data = msg.get("result", {})

        points = []
        for entry in data.get(entity_id, []):
            mean = entry.get("mean")
            if mean is None:
                mean = entry.get("state")
            if mean is None:
                continue
            start_ts = entry.get("start")
            if not start_ts:
                continue
            try:
                if isinstance(start_ts, (int, float)):
                    ts_ms = int(start_ts)  # HA returns integer timestamps in ms
                else:
                    ts_ms = int(datetime.datetime.fromisoformat(start_ts.replace("Z", "+00:00")).timestamp() * 1000)
                points.append({"ts": ts_ms, "w": float(mean)})
            except Exception:
                continue
        return points

    except Exception:
        _LOGGER.exception("Failed to fetch chart stats for %s", entity_id)
        return []


# ── Statistics-based history fallback ───────────────────────────────────

async def get_panel_history_from_statistics(entity_ids: list, date_str: str, tz_name: str) -> dict:
    """Fetch hourly power statistics as a fallback when recorder data is unavailable.

    Used for dates older than purge_keep_days. Returns the same format as
    get_panel_history: entity_id -> [{ts: unix_ms, w: float}], one point per hour."""
    if not entity_ids:
        return {}

    try:
        tz = zoneinfo.ZoneInfo(tz_name) if tz_name else datetime.timezone.utc
    except Exception:
        tz = datetime.timezone.utc

    try:
        local_midnight = datetime.datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=tz)
    except Exception:
        now = datetime.datetime.now(tz)
        local_midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)

    start_utc = local_midnight.astimezone(datetime.timezone.utc)
    end_utc = (local_midnight + datetime.timedelta(days=1)).astimezone(datetime.timezone.utc)

    token = _token()
    result = {}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(
                _HA_WS_URL, timeout=aiohttp.ClientTimeout(total=30)
            ) as ws:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_required":
                    return {}
                await ws.send_json({"type": "auth", "access_token": token})
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_ok":
                    return {}
                await ws.send_json({
                    "id": 1,
                    "type": "recorder/statistics_during_period",
                    "start_time": start_utc.isoformat(),
                    "end_time": end_utc.isoformat(),
                    "statistic_ids": entity_ids,
                    "period": "hour",
                    "types": ["mean"],
                })
                msg = await asyncio.wait_for(ws.receive_json(), timeout=30)
                if not msg.get("success"):
                    _LOGGER.warning("Statistics fallback failed: %s", msg.get("error"))
                    return {}
                data = msg.get("result", {})

        for eid in entity_ids:
            entries = data.get(eid, [])
            points = []
            for entry in entries:
                mean = entry.get("mean")
                if mean is None:
                    mean = entry.get("state")
                if mean is None:
                    continue
                start_ts = entry.get("start")
                if not start_ts:
                    continue
                try:
                    if isinstance(start_ts, (int, float)):
                        ts_ms = int(start_ts)  # HA returns integer timestamps in ms
                    else:
                        ts_ms = int(datetime.datetime.fromisoformat(start_ts.replace("Z", "+00:00")).timestamp() * 1000)
                    points.append({"ts": ts_ms, "w": float(mean)})
                except Exception:
                    continue
            if points:
                result[eid] = points

    except Exception:
        _LOGGER.exception("Failed to fetch statistics fallback for %s", date_str)

    _LOGGER.info("Statistics fallback for %s: %d series returned", date_str, len(result))
    return result


# ── Solar event times ────────────────────────────────────────────────────

def extract_sun_times(sun_attrs: dict, tz_name: str) -> dict:
    """Extract today's solar event unix timestamps from sun.sun next_* attributes.

    Handles the fact that next_* is always a future event: we check whether
    subtracting 24h puts the event within today's local date range."""
    try:
        tz = zoneinfo.ZoneInfo(tz_name) if tz_name else datetime.timezone.utc
    except Exception:
        tz = datetime.timezone.utc

    now = datetime.datetime.now(tz)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    today_end = today_start + 86400

    def resolve(attr_name: str):
        raw = sun_attrs.get(attr_name, "")
        if not raw:
            return None
        try:
            dt = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            ts = dt.timestamp()
            if today_start <= ts < today_end:
                return ts
            candidate = ts - 86400
            if today_start <= candidate < today_end:
                return candidate
            return ts
        except Exception:
            return None

    return {
        "dawn":       resolve("next_dawn"),
        "sunrise":    resolve("next_rising"),
        "solar_noon": resolve("next_noon"),
        "sunset":     resolve("next_setting"),
        "dusk":       resolve("next_dusk"),
        "elevation":  sun_attrs.get("elevation"),
        "azimuth":    sun_attrs.get("azimuth"),
    }


# ── Panel history for time slider ────────────────────────────────────────

async def get_panel_history(entity_ids: list, date_str: str, tz_name: str) -> dict:
    """Fetch power readings for all panel entities for the given date (YYYY-MM-DD).

    Returns dict of entity_id -> list of {ts: unix_ms, w: float}.
    Uses a single batched HA history API call."""
    if not entity_ids:
        return {}

    try:
        tz = zoneinfo.ZoneInfo(tz_name) if tz_name else datetime.timezone.utc
    except Exception:
        tz = datetime.timezone.utc

    try:
        local_midnight = datetime.datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=tz)
    except Exception:
        now = datetime.datetime.now(tz)
        local_midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)

    start_utc = local_midnight.astimezone(datetime.timezone.utc)
    end_utc = (local_midnight + datetime.timedelta(days=1)).astimezone(datetime.timezone.utc)
    start_str = start_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_str = end_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

    params = urlencode({
        "filter_entity_id": ",".join(entity_ids),
        "end_time": end_str,
        "minimal_response": "true",
        "no_attributes": "true",
    })
    url = f"{HA_API_URL}/history/period/{start_str}?{params}"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url, headers=_headers(), timeout=aiohttp.ClientTimeout(total=60)
            ) as resp:
                if resp.status != 200:
                    _LOGGER.warning("History API returned %d for %s", resp.status, date_str)
                    return {}
                raw = await resp.json()
    except Exception:
        _LOGGER.exception("Failed to fetch panel history for %s", date_str)
        return {}

    result = {}
    for series in raw:
        if not series:
            continue
        eid = series[0].get("entity_id") if "entity_id" in series[0] else None
        if not eid:
            # minimal_response: first item has entity_id, rest only have state/last_changed
            # The entity_id is in the first record
            eid = series[0].get("entity_id")
        points = []
        for item in series:
            state = item.get("state", "")
            ts_str = item.get("last_changed", "")
            if state in ("unavailable", "unknown", ""):
                continue
            try:
                w = float(state)
            except (ValueError, TypeError):
                continue
            try:
                dt = datetime.datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                ts_ms = int(dt.timestamp() * 1000)
            except Exception:
                continue
            points.append({"ts": ts_ms, "w": w})
        if eid and points:
            result[eid] = points

    _LOGGER.debug("History for %s: %d series returned", date_str, len(result))
    return result


# ── Array-level production chart ─────────────────────────────────────────

async def get_array_stats_chart(power_ids: list, kw_ids: set,
                                start_utc: datetime.datetime,
                                end_utc: datetime.datetime,
                                period: str, local_tz,
                                min_avg_w: float = 0.0) -> list:
    """Fetch and aggregate power statistics across all inverters for the array chart.

    Returns list of {ts_ms, kwh} sorted chronologically (no labels; handler adds them).
    period: 'hour', 'day', or 'month'.
    kWh = mean_W * period_hours / 1000 (daily/monthly means include night/off-peak zeros).
    Buckets where per-inverter average is below min_avg_w are zeroed (stale overnight readings)."""
    if not power_ids:
        return []

    token = _token()
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(
                _HA_WS_URL, timeout=aiohttp.ClientTimeout(total=30)
            ) as ws:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_required":
                    return []
                await ws.send_json({"type": "auth", "access_token": token})
                msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
                if msg.get("type") != "auth_ok":
                    return []
                await ws.send_json({
                    "id": 1,
                    "type": "recorder/statistics_during_period",
                    "start_time": start_utc.isoformat(),
                    "end_time": end_utc.isoformat(),
                    "statistic_ids": power_ids,
                    "period": period,
                })
                msg = await asyncio.wait_for(ws.receive_json(), timeout=30)
                if not msg.get("success"):
                    _LOGGER.warning("Array chart stats failed: %s", msg.get("error"))
                    return []
                data = msg.get("result", {})
    except Exception:
        _LOGGER.exception("Failed to fetch array chart stats")
        return []

    buckets: dict = {}
    for eid, entries in data.items():
        for entry in entries:
            mean = entry.get("mean")
            if mean is None:
                mean = entry.get("state")
            if mean is None:
                continue
            start_ts = entry.get("start")
            if not start_ts:
                continue
            try:
                if isinstance(start_ts, (int, float)):
                    ts_ms = int(start_ts)
                else:
                    ts_ms = int(datetime.datetime.fromisoformat(
                        start_ts.replace("Z", "+00:00")).timestamp() * 1000)
                w = float(mean)
                if eid in kw_ids:
                    w *= 1000
                buckets[ts_ms] = buckets.get(ts_ms, 0.0) + w
            except Exception:
                continue

    num_panels = len(power_ids)
    points = []
    for ts_ms in sorted(buckets):
        total_w = buckets[ts_ms]
        if min_avg_w > 0 and num_panels > 0 and (total_w / num_panels) < min_avg_w:
            continue
        dt = datetime.datetime.fromtimestamp(ts_ms / 1000, tz=local_tz)
        if period == "hour":
            hours = 1.0
        elif period == "month":
            hours = float(calendar.monthrange(dt.year, dt.month)[1] * 24)
        else:
            hours = 24.0
        kwh = round(total_w * hours / 1000.0, 3)
        points.append({"ts_ms": ts_ms, "kwh": kwh})

    return points
