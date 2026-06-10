"""HA data fetchers for Solar Sentinel.

All HA communication lives here: Energy Dashboard discovery, entity states,
WebSocket registry queries, statistics (today Wh), and history (time slider)."""

import asyncio
import calendar
import datetime
import json
import logging
import math
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


async def get_ha_location() -> dict:
    """Fetch the HA installation's latitude/longitude/elevation from /config.

    Returns {"latitude", "longitude", "elevation"} with float values, or an
    empty dict if the config doesn't expose coordinates."""
    cfg = await get_ha_config()
    lat = cfg.get("latitude")
    lon = cfg.get("longitude")
    if lat is None or lon is None:
        return {}
    return {
        "latitude": float(lat),
        "longitude": float(lon),
        "elevation": float(cfg.get("elevation", 0) or 0),
    }


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


# ── Grid entity discovery ────────────────────────────────────────────────

async def discover_grid_entities() -> dict:
    """Discover grid import/export energy entities from the Energy Dashboard.

    Returns {"import_id": str|None, "import_unit": str,
             "export_id": str|None,  "export_unit": str}"""
    energy_config = await get_energy_config()
    result = {"import_id": None, "import_unit": "kWh",
              "export_id": None,  "export_unit": "kWh"}

    sources = energy_config.get("energy_sources", [])
    for src in sources:
        if src.get("type") != "grid":
            continue
        # Newer HA: nested flow_from/flow_to arrays
        flow_from = src.get("flow_from", [])
        flow_to   = src.get("flow_to",   [])
        if flow_from and not result["import_id"]:
            result["import_id"] = flow_from[0].get("stat_energy_from")
        if flow_to and not result["export_id"]:
            result["export_id"] = flow_to[0].get("stat_energy_to")
        # Older HA / flat format: stat_energy_from/stat_energy_to directly on source
        if not result["import_id"]:
            result["import_id"] = src.get("stat_energy_from")
        if not result["export_id"]:
            result["export_id"] = src.get("stat_energy_to")

    # Confirm units via entity states
    check_ids = [x for x in (result["import_id"], result["export_id"]) if x]
    if check_ids:
        states = await get_entity_states_batch(check_ids)
        for key, eid in (("import_unit", result["import_id"]),
                         ("export_unit", result["export_id"])):
            if eid and eid in states:
                unit = states[eid].get("attributes", {}).get("unit_of_measurement", "kWh")
                result[key] = unit if unit in ("Wh", "kWh") else "kWh"

    _LOGGER.info("Grid entities: import=%s (%s), export=%s (%s)",
                 result["import_id"], result["import_unit"],
                 result["export_id"], result["export_unit"])
    return result


# ── Grid import/export chart statistics ──────────────────────────────────

async def get_grid_stats_chart(import_id, import_unit: str,
                               export_id, export_unit: str,
                               solar_energy_ids: list, solar_wh_eids: set,
                               start_utc: datetime.datetime,
                               end_utc: datetime.datetime,
                               period: str) -> list:
    """Fetch grid import/export and solar energy statistics for the grid chart.

    Returns list of {ts_ms, import_kwh, export_kwh, solar_kwh, consumed_solar_kwh}."""
    stat_ids = [x for x in (import_id, export_id) if x] + list(solar_energy_ids)
    if not stat_ids:
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
                    "statistic_ids": stat_ids,
                    "period": period,
                    "types": ["change"],
                })
                msg = await asyncio.wait_for(ws.receive_json(), timeout=30)
                if not msg.get("success"):
                    _LOGGER.warning("Grid chart stats failed: %s", msg.get("error"))
                    return []
                data = msg.get("result", {})
    except Exception:
        _LOGGER.exception("Failed to fetch grid chart stats")
        return []

    def _ts_map(eid):
        result = {}
        for entry in data.get(eid, []):
            ts = entry.get("start")
            change = entry.get("change")
            if ts is None or change is None:
                continue
            try:
                if isinstance(ts, (int, float)):
                    ts_ms = int(ts)
                else:
                    ts_ms = int(datetime.datetime.fromisoformat(
                        ts.replace("Z", "+00:00")).timestamp() * 1000)
                result[ts_ms] = float(change)
            except Exception:
                continue
        return result

    import_map = _ts_map(import_id) if import_id else {}
    export_map = _ts_map(export_id) if export_id else {}
    solar_maps = {eid: _ts_map(eid) for eid in solar_energy_ids}

    # Unit normalisation to kWh
    if import_unit == "Wh":
        import_map = {ts: v / 1000 for ts, v in import_map.items()}
    if export_unit == "Wh":
        export_map = {ts: v / 1000 for ts, v in export_map.items()}
    for eid in solar_wh_eids:
        if eid in solar_maps:
            solar_maps[eid] = {ts: v / 1000 for ts, v in solar_maps[eid].items()}

    all_ts = set(import_map) | set(export_map)
    for m in solar_maps.values():
        all_ts |= set(m)

    points = []
    for ts_ms in sorted(all_ts):
        import_kwh = max(0.0, import_map.get(ts_ms, 0.0))
        export_kwh = max(0.0, export_map.get(ts_ms, 0.0))
        solar_kwh  = max(0.0, sum(m.get(ts_ms, 0.0) for m in solar_maps.values()))
        consumed   = max(0.0, solar_kwh - export_kwh)
        points.append({
            "ts_ms":               ts_ms,
            "import_kwh":          round(import_kwh, 3),
            "export_kwh":          round(export_kwh,  3),
            "solar_kwh":           round(solar_kwh,   3),
            "consumed_solar_kwh":  round(consumed,    3),
        })

    return points


# ── Battery discovery ────────────────────────────────────────────────────

async def discover_battery_sources() -> list:
    """Discover battery descriptors from the Energy Dashboard.

    Returns one dict per type:"battery" energy source:
      idx, name, power_entity_id, power_unit,
      charge_energy_id, charge_unit, discharge_energy_id, discharge_unit,
      soc_entity_id, mode_entity_id (optional), device_entity_ids
    """
    energy_config = await get_energy_config()
    battery_srcs = [s for s in energy_config.get("energy_sources", [])
                    if s.get("type") == "battery"]
    if not battery_srcs:
        _LOGGER.info("No battery sources in Energy Dashboard")
        return []

    registry = await get_entity_registry()
    registry_by_id = {e["entity_id"]: e for e in registry}
    by_device: dict = {}
    for e in registry:
        dev = e.get("device_id")
        if dev:
            by_device.setdefault(dev, []).append(e)

    result = []
    for idx, src in enumerate(battery_srcs):
        discharge_eid = src.get("stat_energy_from")
        charge_eid    = src.get("stat_energy_to")

        # HA stores power config in power_config (newer) or stat_rate (legacy)
        power_config = src.get("power_config", {})
        if power_config:
            if "stat_rate_inverted" in power_config:
                power_eid = power_config["stat_rate_inverted"]
                ha_invert = True
            elif "stat_rate" in power_config:
                power_eid = power_config["stat_rate"]
                ha_invert = False
            elif "stat_rate_from" in power_config or "stat_rate_to" in power_config:
                # Two-sensor config: separate charge/discharge rate entities; not yet supported
                power_eid = None
                ha_invert = False
            else:
                power_eid = None
                ha_invert = False
        else:
            power_eid = src.get("stat_rate")
            ha_invert = False

        device_id = None
        for eid in (discharge_eid, charge_eid, power_eid):
            if eid:
                dev = registry_by_id.get(eid, {}).get("device_id")
                if dev:
                    device_id = dev
                    break

        device_entries = by_device.get(device_id, []) if device_id else []
        device_eids = [e["entity_id"] for e in device_entries]

        candidate_ids = list({discharge_eid, charge_eid, power_eid} | set(device_eids) - {None})
        states = await get_entity_states_batch([x for x in candidate_ids if x])

        power_unit = "W"
        if power_eid and power_eid in states:
            u = states[power_eid].get("attributes", {}).get("unit_of_measurement", "W")
            if u in ("W", "kW"):
                power_unit = u

        soc_candidates = []
        for entry in device_entries:
            eid = entry["entity_id"]
            attrs = states.get(eid, {}).get("attributes", {})
            if (attrs.get("unit_of_measurement") == "%" and
                    attrs.get("state_class") == "measurement"):
                soc_candidates.append({
                    "entity_id": eid,
                    "friendly_name": attrs.get("friendly_name", eid),
                })

        soc_entity_id = None
        panel_name = "Battery" if len(battery_srcs) == 1 else f"Battery {idx + 1}"
        if soc_candidates:
            best = min(soc_candidates, key=lambda c: len(c["friendly_name"]))
            soc_entity_id = best["entity_id"]
            raw_name = best["friendly_name"]
            for suffix in (" State of Charge", " SOC", " SoC"):
                if raw_name.endswith(suffix):
                    raw_name = raw_name[: -len(suffix)].strip()
                    break
            if raw_name:
                panel_name = raw_name

        mode_entity_id = None
        for keyword in ("operating_mode", "mode"):
            for entry in device_entries:
                eid = entry["entity_id"]
                if keyword in eid.lower():
                    raw = states.get(eid, {}).get("state", "")
                    if raw and raw not in ("unavailable", "unknown"):
                        mode_entity_id = eid
                        break
            if mode_entity_id:
                break

        def _unit(eid, fallback="kWh"):
            if not eid:
                return fallback
            u = states.get(eid, {}).get("attributes", {}).get("unit_of_measurement", fallback)
            return u if u in ("Wh", "kWh") else fallback

        invert_power = ha_invert
        if ha_invert:
            _LOGGER.info("Battery %d: HA config reports inverted power sensor (stat_rate_inverted)", idx)

        result.append({
            "idx": idx,
            "name": panel_name,
            "power_entity_id": power_eid,
            "power_unit": power_unit,
            "charge_energy_id": charge_eid,
            "charge_unit": _unit(charge_eid),
            "discharge_energy_id": discharge_eid,
            "discharge_unit": _unit(discharge_eid),
            "soc_entity_id": soc_entity_id,
            "mode_entity_id": mode_entity_id,
            "device_entity_ids": device_eids,
            "invert_power": invert_power,
        })

    result.sort(key=lambda b: b["name"])
    for i, b in enumerate(result):
        b["idx"] = i
    _LOGGER.info("Discovered %d battery source(s)", len(result))
    return result


async def get_battery_today_kwh(batteries: list, tz_name: str) -> dict:
    """Return today's charged and discharged kWh per battery energy sensor.

    Returns dict of entity_id -> kwh_float."""
    energy_pairs = []
    for bat in batteries:
        for eid, unit in (
            (bat.get("charge_energy_id"), bat.get("charge_unit", "kWh")),
            (bat.get("discharge_energy_id"), bat.get("discharge_unit", "kWh")),
        ):
            if eid:
                energy_pairs.append((eid, unit))
    if not energy_pairs:
        return {}

    try:
        tz = zoneinfo.ZoneInfo(tz_name) if tz_name else datetime.timezone.utc
    except Exception:
        tz = datetime.timezone.utc

    now = datetime.datetime.now(tz)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
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
                    "start_time": midnight.isoformat(),
                    "end_time": now.isoformat(),
                    "statistic_ids": statistic_ids,
                    "period": "day",
                    "types": ["change"],
                })
                msg = await asyncio.wait_for(ws.receive_json(), timeout=30)
                if not msg.get("success"):
                    _LOGGER.warning("Battery today kWh stats failed: %s", msg.get("error"))
                    return {}
                data = msg.get("result", {})
        for eid in statistic_ids:
            entries = data.get(eid, [])
            if entries:
                change = entries[0].get("change") or 0
                kwh = float(change) if unit_map.get(eid) != "Wh" else float(change) / 1000
                result[eid] = round(max(0.0, kwh), 2)
    except Exception:
        _LOGGER.exception("Failed to fetch battery today kWh")
    return result


async def get_battery_soc_history(soc_entity_id: str, date_str: str, tz_name: str) -> list:
    """Fetch SoC % history for the given date via the HA history API.

    Returns list of {ts_ms, soc_pct} sorted chronologically."""
    history = await get_panel_history([soc_entity_id], date_str, tz_name)
    points = history.get(soc_entity_id, [])
    return [{"ts_ms": pt["ts"], "soc_pct": pt["w"]} for pt in points]


async def get_battery_stats_chart(charge_id, charge_unit: str,
                                  discharge_id, discharge_unit: str,
                                  start_utc: datetime.datetime,
                                  end_utc: datetime.datetime,
                                  period: str) -> list:
    """Fetch charged and discharged kWh statistics for the battery chart.

    Returns list of {ts_ms, charged_kwh, discharged_kwh}."""
    stat_ids = [x for x in (charge_id, discharge_id) if x]
    if not stat_ids:
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
                    "statistic_ids": stat_ids,
                    "period": period,
                    "types": ["change"],
                })
                msg = await asyncio.wait_for(ws.receive_json(), timeout=30)
                if not msg.get("success"):
                    _LOGGER.warning("Battery chart stats failed: %s", msg.get("error"))
                    return []
                data = msg.get("result", {})
    except Exception:
        _LOGGER.exception("Failed to fetch battery chart stats")
        return []

    def _ts_map(eid, unit):
        m = {}
        for entry in data.get(eid, []):
            ts = entry.get("start")
            change = entry.get("change")
            if ts is None or change is None:
                continue
            try:
                if isinstance(ts, (int, float)):
                    ts_ms = int(ts)
                else:
                    ts_ms = int(datetime.datetime.fromisoformat(
                        ts.replace("Z", "+00:00")).timestamp() * 1000)
                kwh = float(change) if unit != "Wh" else float(change) / 1000
                m[ts_ms] = max(0.0, kwh)
            except Exception:
                continue
        return m

    charge_map    = _ts_map(charge_id, charge_unit)       if charge_id    else {}
    discharge_map = _ts_map(discharge_id, discharge_unit) if discharge_id else {}

    all_ts = set(charge_map) | set(discharge_map)
    points = []
    for ts_ms in sorted(all_ts):
        points.append({
            "ts_ms":          ts_ms,
            "charged_kwh":    round(charge_map.get(ts_ms, 0.0), 3),
            "discharged_kwh": round(discharge_map.get(ts_ms, 0.0), 3),
        })
    return points


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
            val = entry.get("max") if period == "day" else entry.get("mean")
            if val is None:
                val = entry.get("state")
            if val is None:
                continue
            start_ts = entry.get("start")
            if not start_ts:
                continue
            try:
                if isinstance(start_ts, (int, float)):
                    ts_ms = int(start_ts)  # HA returns integer timestamps in ms
                else:
                    ts_ms = int(datetime.datetime.fromisoformat(start_ts.replace("Z", "+00:00")).timestamp() * 1000)
                points.append({"ts": ts_ms, "w": float(val)})
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


def _julian_day(dt_utc: datetime.datetime) -> float:
    """Julian Day number for a UTC datetime."""
    a = dt_utc.year
    m = dt_utc.month
    day = dt_utc.day + (dt_utc.hour + dt_utc.minute / 60 + dt_utc.second / 3600) / 24
    if m <= 2:
        a -= 1
        m += 12
    aa = a // 100
    bb = 2 - aa + aa // 4
    return int(365.25 * (a + 4716)) + int(30.6001 * (m + 1)) + day + bb - 1524.5


def compute_sun_times(date_str: str, lat: float, lon: float, tz_name: str) -> dict:
    """Compute solar event unix timestamps for an arbitrary local date.

    Uses the NOAA solar position algorithm. No network access required.
    dawn/dusk use civil twilight (sun 6 deg below horizon), matching the
    definition Home Assistant's sun.sun entity uses, so computed past dates
    stay consistent with the live "today" values.

    Returns a dict with the same shape as extract_sun_times (sunrise, sunset,
    solar_noon, dawn, dusk). Events that don't occur (polar day/night) are
    omitted.
    """
    try:
        tz = zoneinfo.ZoneInfo(tz_name) if tz_name else datetime.timezone.utc
    except Exception:
        tz = datetime.timezone.utc

    y, mo, d = (int(x) for x in date_str.split("-"))
    midnight_local = datetime.datetime(y, mo, d, 0, 0, 0, tzinfo=tz)
    noon_local = datetime.datetime(y, mo, d, 12, 0, 0, tzinfo=tz)
    jd = _julian_day(noon_local.astimezone(datetime.timezone.utc))
    jc = (jd - 2451545.0) / 36525.0  # Julian century

    gml = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360  # geom mean long
    gma = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)          # geom mean anomaly
    ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)     # orbit eccentricity
    soc = (math.sin(math.radians(gma)) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
           + math.sin(math.radians(2 * gma)) * (0.019993 - 0.000101 * jc)
           + math.sin(math.radians(3 * gma)) * 0.000289)
    app_long = gml + soc - 0.00569 - 0.00478 * math.sin(math.radians(125.04 - 1934.136 * jc))
    obliq = 23 + (26 + ((21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813)))) / 60) / 60
    obliq_corr = obliq + 0.00256 * math.cos(math.radians(125.04 - 1934.136 * jc))
    decl = math.degrees(math.asin(
        math.sin(math.radians(obliq_corr)) * math.sin(math.radians(app_long))))
    vary = math.tan(math.radians(obliq_corr / 2)) ** 2
    eot = 4 * math.degrees(
        vary * math.sin(2 * math.radians(gml))
        - 2 * ecc * math.sin(math.radians(gma))
        + 4 * ecc * vary * math.sin(math.radians(gma)) * math.cos(2 * math.radians(gml))
        - 0.5 * vary * vary * math.sin(4 * math.radians(gml))
        - 1.25 * ecc * ecc * math.sin(2 * math.radians(gma))
    )

    tz_offset_hours = noon_local.utcoffset().total_seconds() / 3600
    solar_noon_min = 720 - 4 * lon - eot + tz_offset_hours * 60

    def hour_angle(elev_deg: float):
        cos_h = (math.cos(math.radians(90 - elev_deg))
                 - math.sin(math.radians(lat)) * math.sin(math.radians(decl))) \
                / (math.cos(math.radians(lat)) * math.cos(math.radians(decl)))
        if cos_h > 1 or cos_h < -1:
            return None  # sun never reaches this angle on this date
        return math.degrees(math.acos(cos_h))

    def event_ts(minutes_from_midnight: float) -> float:
        return (midnight_local + datetime.timedelta(minutes=minutes_from_midnight)).timestamp()

    out = {"solar_noon": event_ts(solar_noon_min)}
    ha_sun = hour_angle(-0.833)   # standard sunrise/sunset (refraction + sun radius)
    if ha_sun is not None:
        out["sunrise"] = event_ts(solar_noon_min - ha_sun * 4)
        out["sunset"] = event_ts(solar_noon_min + ha_sun * 4)
    ha_civil = hour_angle(-6.0)   # civil twilight = HA dawn/dusk
    if ha_civil is not None:
        out["dawn"] = event_ts(solar_noon_min - ha_civil * 4)
        out["dusk"] = event_ts(solar_noon_min + ha_civil * 4)
    return out


def compute_moon_phase(date_str: str) -> str:
    """Compute the moon phase for a local date (evaluated at noon UTC).

    Returns one of the eight phase strings used by HA's sensor.moon, so the
    arc's moon glyph renders identically to the live value.
    """
    y, mo, d = (int(x) for x in date_str.split("-"))
    jd = _julian_day(datetime.datetime(y, mo, d, 12, 0, 0, tzinfo=datetime.timezone.utc))
    t = (jd - 2451545.0) / 36525.0
    mean_d = 297.8501921 + 445267.1114034 * t - 0.0018819 * t * t  # mean elongation
    sun_anom = 357.5291092 + 35999.0502909 * t                     # sun mean anomaly
    moon_anom = 134.9633964 + 477198.8675055 * t                   # moon mean anomaly
    elong = (mean_d
             + 6.289 * math.sin(math.radians(moon_anom))
             - 2.100 * math.sin(math.radians(sun_anom))
             + 1.274 * math.sin(math.radians(2 * mean_d - moon_anom))
             + 0.658 * math.sin(math.radians(2 * mean_d))
             + 0.214 * math.sin(math.radians(2 * moon_anom))
             + 0.110 * math.sin(math.radians(mean_d))) % 360
    frac = elong / 360.0
    if frac < 0.0625 or frac >= 0.9375:
        return "new_moon"
    if frac < 0.1875:
        return "waxing_crescent"
    if frac < 0.3125:
        return "first_quarter"
    if frac < 0.4375:
        return "waxing_gibbous"
    if frac < 0.5625:
        return "full_moon"
    if frac < 0.6875:
        return "waning_gibbous"
    if frac < 0.8125:
        return "last_quarter"
    return "waning_crescent"


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


# ── Entity states at a historical timestamp ──────────────────────────────

async def get_entity_states_at_time(entity_ids: list, target_dt: datetime.datetime) -> dict:
    """Return the last-known state for each entity at or before target_dt.

    Uses a 2-hour lookback window. Returns dict of entity_id -> state_string."""
    if not entity_ids:
        return {}

    start_dt = target_dt - datetime.timedelta(hours=2)
    start_str = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_str = target_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

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
                url, headers=_headers(), timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status != 200:
                    return {}
                raw = await resp.json()
    except Exception:
        _LOGGER.exception("Failed to fetch entity states at time")
        return {}

    target_ts_ms = target_dt.timestamp() * 1000
    result = {}
    for series in raw:
        if not series:
            continue
        eid = series[0].get("entity_id")
        if not eid:
            continue
        best = None
        for item in series:
            ts_str = item.get("last_changed", "")
            try:
                dt = datetime.datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                if dt.timestamp() * 1000 <= target_ts_ms:
                    best = item.get("state", "")
            except Exception:
                continue
        if best is not None:
            result[eid] = best
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


# ── Weather forecast ─────────────────────────────────────────────────────

async def get_weather_forecast(tz_name: str) -> dict:
    """Fetch today and tomorrow forecasts from the first weather.* entity.

    Tries forecast types in order: daily, twice_daily. Most integrations support
    at least one. NWS only supports twice_daily (day/night periods); for that format
    the daytime period provides condition and high temp, nighttime provides low temp.

    Returns {"today": {...}, "tomorrow": {...}} or {} if unavailable or no entity found.
    Each day: {"date": "M/D", "condition": str, "high": int|None, "low": int|None}."""
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
    except Exception:
        _LOGGER.exception("Failed to fetch states for weather discovery")
        return {}

    # Only consider entities with a live state; prefer non-hourly entities
    weather_candidates = [
        s["entity_id"] for s in all_states
        if s["entity_id"].startswith("weather.")
        and s.get("state") not in ("unavailable", "unknown", None)
    ]
    if not weather_candidates:
        _LOGGER.debug("No live weather.* entities found; skipping weather display")
        return {}

    # Prefer entities without "hourly" in the name (e.g. weather.nws over weather.nws_hourly)
    preferred = [e for e in weather_candidates if "hourly" not in e]
    weather_eid = (preferred or weather_candidates)[0]
    _LOGGER.info("Fetching forecast from weather entity: %s (candidates: %s)", weather_eid, weather_candidates)

    try:
        tz = zoneinfo.ZoneInfo(tz_name) if tz_name else datetime.timezone.utc
    except Exception:
        tz = datetime.timezone.utc

    now = datetime.datetime.now(tz)
    today_date = now.date()
    tomorrow_date = today_date + datetime.timedelta(days=1)

    token = _token()
    forecasts = []
    forecast_type_used = None

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

                # Try daily first; fall back to twice_daily if unsupported
                for msg_id, fc_type in enumerate(("daily", "twice_daily"), start=1):
                    await ws.send_json({
                        "id": msg_id,
                        "type": "call_service",
                        "domain": "weather",
                        "service": "get_forecasts",
                        "service_data": {"type": fc_type},
                        "target": {"entity_id": weather_eid},
                        "return_response": True,
                    })
                    resp_msg = await asyncio.wait_for(ws.receive_json(), timeout=15)
                    if resp_msg.get("success"):
                        forecasts = (resp_msg.get("result", {}).get("response", {})
                                     .get(weather_eid, {}).get("forecast", []))
                        forecast_type_used = fc_type
                        _LOGGER.info("Using %s forecast from %s", fc_type, weather_eid)
                        break
                    _LOGGER.debug("Forecast type '%s' not supported by %s, trying next", fc_type, weather_eid)
    except Exception:
        _LOGGER.exception("Failed to fetch weather forecast from %s", weather_eid)
        return {}

    if not forecasts or not forecast_type_used:
        _LOGGER.warning("No usable forecast from %s (tried daily, twice_daily)", weather_eid)
        return {}

    def _fc_date(fc):
        try:
            return datetime.datetime.fromisoformat(
                fc.get("datetime", "").replace("Z", "+00:00")).astimezone(tz).date()
        except Exception:
            return None

    if forecast_type_used == "daily":
        result = {}
        for fc in forecasts:
            fc_date = _fc_date(fc)
            if fc_date is None:
                continue
            high = fc.get("temperature")
            low = fc.get("templow")
            entry = {
                "date": f"{fc_date.month}/{fc_date.day}",
                "condition": fc.get("condition", ""),
                "high": round(high) if high is not None else None,
                "low":  round(low)  if low  is not None else None,
            }
            if fc_date == today_date and "today" not in result:
                result["today"] = entry
            elif fc_date == tomorrow_date and "tomorrow" not in result:
                result["tomorrow"] = entry
            if "today" in result and "tomorrow" in result:
                break

    else:  # twice_daily: pair daytime and nighttime entries by date
        by_date: dict = {}
        for fc in forecasts:
            fc_date = _fc_date(fc)
            if fc_date is None:
                continue
            slot = "day" if fc.get("is_daytime", True) else "night"
            by_date.setdefault(fc_date, {})[slot] = fc

        result = {}
        for target_date, label in ((today_date, "today"), (tomorrow_date, "tomorrow")):
            day_fc = by_date.get(target_date, {}).get("day")
            night_fc = by_date.get(target_date, {}).get("night")
            main_fc = day_fc or night_fc
            if not main_fc:
                continue
            high = day_fc.get("temperature") if day_fc else None
            low = night_fc.get("temperature") if night_fc else None
            result[label] = {
                "date": f"{target_date.month}/{target_date.day}",
                "condition": (day_fc or night_fc).get("condition", ""),
                "high": round(high) if high is not None else None,
                "low":  round(low)  if low  is not None else None,
            }

    _LOGGER.info("Weather: today=%s, tomorrow=%s",
                 result.get("today", {}).get("condition"),
                 result.get("tomorrow", {}).get("condition"))
    return result


# ── Battery / debug discovery ────────────────────────────────────────────

async def get_debug_info() -> dict:
    """Gather battery discovery debug info for issue reporting.

    Returns the raw Energy Dashboard config, all battery-type energy sources,
    every entity that shares a device with a battery stat entity, and current
    states for those entities. Universal: works with any integration."""
    result = {
        "energy_config_raw": {},
        "battery_sources": [],
        "battery_device_entity_ids": [],
        "battery_device_entity_states": {},
        "note": "Paste this JSON into a GitHub issue to help with battery feature development.",
    }

    try:
        energy_config = await get_energy_config()
        result["energy_config_raw"] = energy_config

        sources = energy_config.get("energy_sources", [])
        battery_sources = [s for s in sources if s.get("type") == "battery"]
        result["battery_sources"] = battery_sources

        if not battery_sources:
            result["note"] += " No battery sources found in the HA Energy Dashboard."
            return result

        # Collect the stat entity IDs named in the energy config
        stat_eids = set()
        for src in battery_sources:
            if src.get("stat_energy_to"):
                stat_eids.add(src["stat_energy_to"])
            if src.get("stat_energy_from"):
                stat_eids.add(src["stat_energy_from"])

        # Find the device_ids these stat entities belong to
        registry = await get_entity_registry()
        stat_devices = set()
        for entry in registry:
            if entry.get("entity_id") in stat_eids and entry.get("device_id"):
                stat_devices.add(entry["device_id"])

        # Collect all entity_ids on those devices
        device_entity_ids = [
            entry["entity_id"]
            for entry in registry
            if entry.get("device_id") in stat_devices
        ]
        result["battery_device_entity_ids"] = sorted(device_entity_ids)

        # Fetch current states for all of them
        all_eids = sorted(stat_eids | set(device_entity_ids))
        states = await get_entity_states_batch(all_eids)
        result["battery_device_entity_states"] = {
            eid: {
                "state": s.get("state"),
                "attributes": {
                    k: v for k, v in s.get("attributes", {}).items()
                    if k in ("unit_of_measurement", "device_class", "state_class",
                             "friendly_name", "last_updated")
                },
            }
            for eid, s in states.items()
        }

    except Exception:
        _LOGGER.exception("get_debug_info failed")
        result["error"] = "Exception during debug info gathering; check addon logs."

    return result
