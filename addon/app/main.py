"""Solar Sentinel -- aiohttp web server and main refresh loop.

Orchestrates HA data fetching (ha_api), persistence (storage), and the
panel color-coding logic. Route handlers are thin; they return cached data
or delegate to ha_api for on-demand requests (history, sun)."""

import asyncio
import datetime
import json
import logging
import os
import zoneinfo

from aiohttp import web

import ha_api
import storage

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
_LOGGER = logging.getLogger(__name__)

VERSION = "2026.05.1"

_inverters: list = []        # discovered inverter descriptors
_panels_cache: list = []     # latest computed panel states
_ha_tz: str = ""             # HA timezone string


# ── Color coding ─────────────────────────────────────────────────────────

_MIN_AVG_W = 5.0  # default; overridden by settings min_avg_w

def _compute_color(power_w: float, avg_w: float, status: str) -> str:
    if status != "online":
        return "gray"
    if avg_w < _MIN_AVG_W:
        return "gray"
    ratio = round(power_w) / avg_w
    if ratio >= 0.88:
        return "green"
    if ratio >= 0.70:
        return "yellow"
    return "red"


# ── Refresh loop ─────────────────────────────────────────────────────────

async def do_refresh():
    global _panels_cache, _ha_tz, _inverters

    if not _ha_tz:
        _ha_tz = await ha_api.get_ha_timezone()
        _LOGGER.info("HA timezone: %s", _ha_tz or "(unknown)")

    if not _inverters:
        _LOGGER.info("Running inverter discovery...")
        _inverters = await ha_api.discover_solar_inverters()
        if not _inverters:
            _LOGGER.warning("No solar inverters discovered. Is the Energy Dashboard configured?")
            _panels_cache = []
            return

    power_ids = [inv["entity_id"] for inv in _inverters]
    states = await ha_api.get_entity_states_batch(power_ids)

    today_wh_map = await ha_api.get_today_wh(_inverters, _ha_tz)
    layout = storage.get_layout()

    panels = []
    for inv in _inverters:
        eid = inv["entity_id"]
        state = states.get(eid, {})
        raw = state.get("state", "unavailable")

        if raw in ("unavailable", "unknown"):
            status = "unavailable"
            power_w = 0.0
        else:
            try:
                val = float(raw)
                # Sunpower reports in kW; convert to W for consistent display
                power_w = val * 1000 if inv.get("power_unit") == "kW" else val
                status = "online"
            except (ValueError, TypeError):
                status = "unavailable"
                power_w = 0.0

        energy_eid = inv.get("energy_entity_id")
        wh_raw = today_wh_map.get(energy_eid) if energy_eid else None

        panels.append({
            "entity_id": eid,
            "name": layout.get(eid) or inv["name"],
            "power_w": power_w,
            "today_wh": wh_raw,
            "status": status,
        })

    online = [p for p in panels if p["status"] == "online"]
    avg_w = sum(p["power_w"] for p in online) / len(online) if online else 0.0
    total_w = sum(p["power_w"] for p in online)

    # Suppress stale cached readings (e.g. SunPower holds last value after dusk).
    # When the array average is below the minimum meaningful threshold, zero everything out.
    min_avg_w = float(storage.get_settings().get("min_avg_w", _MIN_AVG_W))
    if avg_w < min_avg_w:
        for p in panels:
            p["power_w"] = 0.0
        avg_w = 0.0
        total_w = 0.0

    for p in panels:
        p["color"] = _compute_color(p["power_w"], avg_w, p["status"])

    _panels_cache = panels
    _LOGGER.info(
        "Refreshed: %d panel(s), %.0f W total, %.0f W avg",
        len(panels), total_w, avg_w,
    )


async def refresh_loop():
    while True:
        try:
            await do_refresh()
        except Exception:
            _LOGGER.exception("Refresh failed")
        settings = storage.get_settings()
        interval = max(10, int(settings.get("refresh_interval", 300)))
        await asyncio.sleep(interval)


# ── Route handlers ────────────────────────────────────────────────────────

async def handle_index(request):
    base = request.headers.get("X-Ingress-Path", "").rstrip("/")
    return web.Response(text=_build_html(base), content_type="text/html")


async def handle_icon(request):
    return web.FileResponse("/app/icon.png")


async def handle_api_panels(request):
    online = [p for p in _panels_cache if p["status"] == "online"]
    avg_w = sum(p["power_w"] for p in online) / len(online) if online else 0.0
    total_w = sum(p["power_w"] for p in online)
    payload = {
        "panels": _panels_cache,
        "total_w": round(total_w, 1),
        "avg_w": round(avg_w, 1),
        "count": len(_inverters),
        "timestamp": int(datetime.datetime.now().timestamp()),
    }
    return web.Response(text=json.dumps(payload), content_type="application/json")


async def handle_api_sun(request):
    state = await ha_api.get_sun_state()
    attrs = state.get("attributes", {})
    times = ha_api.extract_sun_times(attrs, _ha_tz)
    moon_phase = await ha_api.get_moon_state()
    if moon_phase:
        times["moon_phase"] = moon_phase
    return web.Response(text=json.dumps(times), content_type="application/json")


async def handle_api_history(request):
    date_str = request.rel_url.query.get("date", "")
    if not date_str:
        try:
            tz = zoneinfo.ZoneInfo(_ha_tz) if _ha_tz else datetime.timezone.utc
        except Exception:
            tz = datetime.timezone.utc
        date_str = datetime.datetime.now(tz).strftime("%Y-%m-%d")

    power_ids = [inv["entity_id"] for inv in _inverters]
    history = await ha_api.get_panel_history(power_ids, date_str, _ha_tz)

    # Fall back to long-term statistics (hourly resolution) if recorder has no data
    statistics_fallback = False
    if not history:
        _LOGGER.info("No recorder data for %s, trying statistics fallback", date_str)
        history = await ha_api.get_panel_history_from_statistics(power_ids, date_str, _ha_tz)
        statistics_fallback = bool(history)

    # Convert kW -> W for inverters that report in kW
    kw_ids = {inv["entity_id"] for inv in _inverters if inv.get("power_unit") == "kW"}
    for eid, points in history.items():
        if eid in kw_ids:
            for pt in points:
                pt["w"] = pt["w"] * 1000

    return web.Response(
        text=json.dumps({"date": date_str, "panels": history, "statistics_fallback": statistics_fallback}),
        content_type="application/json",
    )


async def handle_api_layout_get(request):
    return web.Response(
        text=json.dumps(storage.get_layout()),
        content_type="application/json",
    )


async def handle_api_layout_post(request):
    try:
        data = await request.json()
        result = storage.save_layout(data)
        # Apply updated names to cache immediately
        global _panels_cache
        for p in _panels_cache:
            if p["entity_id"] in result and result[p["entity_id"]]:
                p["name"] = result[p["entity_id"]]
        return web.Response(text=json.dumps(result), content_type="application/json")
    except Exception:
        _LOGGER.exception("Failed to save layout")
        return web.Response(status=400, text="Bad request")


async def handle_api_settings_get(request):
    return web.Response(
        text=json.dumps(storage.get_settings()),
        content_type="application/json",
    )


async def handle_api_settings_post(request):
    try:
        data = await request.json()
        result = storage.save_settings(data)
        return web.Response(text=json.dumps(result), content_type="application/json")
    except Exception:
        _LOGGER.exception("Failed to save settings")
        return web.Response(status=400, text="Bad request")


async def handle_api_rename(request):
    try:
        data = await request.json()
        entity_id = data.get("entity_id", "").strip()
        name = data.get("name", "").strip()
        if not entity_id:
            return web.Response(status=400, text="Missing entity_id")

        ha_name = name if name else None
        await ha_api.rename_entity(entity_id, ha_name)

        # Update our layout storage
        layout = storage.get_layout()
        if name:
            layout[entity_id] = name
        else:
            layout.pop(entity_id, None)
        storage.save_layout(layout)

        # Apply to panels cache immediately
        global _panels_cache
        for p in _panels_cache:
            if p["entity_id"] == entity_id:
                if name:
                    p["name"] = name
                else:
                    inv = next((i for i in _inverters if i["entity_id"] == entity_id), None)
                    p["name"] = inv["name"] if inv else entity_id
                break

        return web.Response(
            text=json.dumps({"ok": True, "entity_id": entity_id, "name": name}),
            content_type="application/json",
        )
    except Exception:
        _LOGGER.exception("Failed to rename panel")
        return web.Response(status=400, text="Bad request")


async def handle_api_rediscover(request):
    global _inverters
    _LOGGER.info("Manual re-discovery triggered")
    _inverters = []
    asyncio.ensure_future(do_refresh())
    return web.Response(text='{"status":"ok"}', content_type="application/json")


async def handle_api_grid_get(request):
    return web.Response(
        text=json.dumps(storage.get_grid()),
        content_type="application/json",
    )


async def handle_api_grid_post(request):
    try:
        data = await request.json()
        result = storage.save_grid(data)
        return web.Response(text=json.dumps(result), content_type="application/json")
    except Exception:
        _LOGGER.exception("Failed to save grid")
        return web.Response(status=400, text="Bad request")


_DETAIL_CLASSES = {"power", "energy", "current", "voltage", "frequency", "temperature", "timestamp"}
_DETAIL_GROUP = {
    "power": "sensors", "energy": "sensors",
    "current": "diagnostics", "voltage": "diagnostics",
    "frequency": "diagnostics", "temperature": "diagnostics",
    "timestamp": "diagnostics",
}
_DETAIL_ORDER = {"power": 0, "energy": 1, "temperature": 2, "voltage": 3,
                 "current": 4, "frequency": 5, "timestamp": 6}


async def handle_api_panel_detail(request):
    entity_id = request.rel_url.query.get("entity_id", "").strip()
    if not entity_id:
        return web.Response(status=400, text="Missing entity_id")
    inv = next((i for i in _inverters if i["entity_id"] == entity_id), None)
    if not inv:
        return web.Response(status=404, text="Inverter not found")

    device_eids = inv.get("device_entity_ids", [])
    states = await ha_api.get_entity_states_batch(device_eids)

    sensors = []
    for eid in device_eids:
        if "mppt" in eid.lower():
            continue
        state = states.get(eid, {})
        attrs = state.get("attributes", {})
        dc = attrs.get("device_class", "")
        if dc not in _DETAIL_CLASSES:
            continue
        sensors.append({
            "entity_id": eid,
            "name": attrs.get("friendly_name", eid),
            "value": state.get("state", "unavailable"),
            "unit": attrs.get("unit_of_measurement", ""),
            "device_class": dc,
            "group": _DETAIL_GROUP.get(dc, "other"),
        })

    sensors.sort(key=lambda s: (0 if s["group"] == "sensors" else 1,
                                _DETAIL_ORDER.get(s["device_class"], 99)))
    return web.Response(
        text=json.dumps({"entity_id": entity_id, "sensors": sensors}),
        content_type="application/json",
    )


async def handle_api_panel_chart(request):
    entity_id = request.rel_url.query.get("entity_id", "").strip()
    range_str = request.rel_url.query.get("range", "30d")
    if not entity_id:
        return web.Response(status=400, text="Missing entity_id")
    inv = next((i for i in _inverters if i["entity_id"] == entity_id), None)
    if not inv:
        return web.Response(status=404, text="Inverter not found")

    try:
        tz = zoneinfo.ZoneInfo(_ha_tz) if _ha_tz else datetime.timezone.utc
    except Exception:
        tz = datetime.timezone.utc

    now = datetime.datetime.now(tz)
    range_map = {
        "7d":  (7,   "hour"),
        "30d": (30,  "hour"),
        "90d": (90,  "hour"),
        "6m":  (180, "day"),
        "1y":  (365, "day"),
    }
    days, period = range_map.get(range_str, (30, "hour"))
    start_local = (now - datetime.timedelta(days=days)).replace(
        hour=0, minute=0, second=0, microsecond=0)
    start_utc = start_local.astimezone(datetime.timezone.utc)
    end_utc = now.astimezone(datetime.timezone.utc)

    points = await ha_api.get_entity_stats_for_chart(entity_id, start_utc, end_utc, period)

    if inv.get("power_unit") == "kW":
        for pt in points:
            pt["w"] = pt["w"] * 1000

    return web.Response(
        text=json.dumps({"entity_id": entity_id, "range": range_str, "points": points}),
        content_type="application/json",
    )


_MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def _pad_hourly(points, local_day, tz, now):
    """Fill zero-kWh slots for every hour from midnight to the current hour."""
    existing_by_hour = {}
    for pt in points:
        dt = datetime.datetime.fromtimestamp(pt["ts_ms"] / 1000, tz=tz)
        existing_by_hour[dt.hour] = pt
    max_hour = now.hour if local_day.date() == now.date() else 23
    result = []
    for h in range(max_hour + 1):
        if h in existing_by_hour:
            result.append(existing_by_hour[h])
        else:
            hour_dt = local_day.replace(hour=h, minute=0, second=0, microsecond=0)
            label = f"{h % 12 or 12}{'a' if h < 12 else 'p'}"
            result.append({"ts_ms": int(hour_dt.timestamp() * 1000), "label": label, "kwh": 0.0})
    return result


def _label_hourly(points, tz):
    result = []
    for pt in points:
        dt = datetime.datetime.fromtimestamp(pt["ts_ms"] / 1000, tz=tz)
        h = dt.hour
        result.append({"ts_ms": pt["ts_ms"], "label": f"{h % 12 or 12}{'a' if h < 12 else 'p'}", "kwh": pt["kwh"]})
    return result


def _aggregate_weekly(daily_points, tz):
    """Bucket daily kWh into Sun-Sat weeks; return up to 5 most recent weeks."""
    by_week = {}
    for pt in daily_points:
        dt = datetime.datetime.fromtimestamp(pt["ts_ms"] / 1000, tz=tz)
        days_since_sunday = (dt.weekday() + 1) % 7
        week_start = (dt - datetime.timedelta(days=days_since_sunday)).replace(
            hour=0, minute=0, second=0, microsecond=0)
        ts_ms = int(week_start.timestamp() * 1000)
        by_week[ts_ms] = by_week.get(ts_ms, 0.0) + pt["kwh"]
    result = []
    for ts_ms in sorted(by_week)[-5:]:
        dt = datetime.datetime.fromtimestamp(ts_ms / 1000, tz=tz)
        result.append({"ts_ms": ts_ms, "label": f"{dt.month}/{dt.day}", "kwh": round(by_week[ts_ms], 2)})
    return result


def _aggregate_monthly(points, tz):
    """Bucket kWh into calendar months; return up to 12 most recent."""
    by_month = {}
    for pt in points:
        dt = datetime.datetime.fromtimestamp(pt["ts_ms"] / 1000, tz=tz)
        key = (dt.year, dt.month)
        by_month[key] = by_month.get(key, 0.0) + pt["kwh"]
    result = []
    for year, month in sorted(by_month)[-12:]:
        month_start = datetime.datetime(year, month, 1, tzinfo=tz)
        result.append({
            "ts_ms": int(month_start.timestamp() * 1000),
            "label": _MONTH_ABBR[month],
            "kwh": round(by_month[(year, month)], 2),
        })
    return result


def _aggregate_yearly(points, tz):
    """Bucket kWh into calendar years."""
    by_year = {}
    for pt in points:
        dt = datetime.datetime.fromtimestamp(pt["ts_ms"] / 1000, tz=tz)
        by_year[dt.year] = by_year.get(dt.year, 0.0) + pt["kwh"]
    result = []
    for year in sorted(by_year):
        year_start = datetime.datetime(year, 1, 1, tzinfo=tz)
        result.append({"ts_ms": int(year_start.timestamp() * 1000), "label": str(year), "kwh": round(by_year[year], 2)})
    return result


async def handle_api_array_chart(request):
    range_str = request.rel_url.query.get("range", "today")
    date_str = request.rel_url.query.get("date", "")

    if not _inverters:
        return web.Response(
            text=json.dumps({"range": range_str, "points": [], "total_kwh": 0}),
            content_type="application/json",
        )

    power_ids = [inv["entity_id"] for inv in _inverters]
    kw_ids = {inv["entity_id"] for inv in _inverters if inv.get("power_unit") == "kW"}
    min_avg_w = float(storage.get_settings().get("min_avg_w", _MIN_AVG_W))

    try:
        tz = zoneinfo.ZoneInfo(_ha_tz) if _ha_tz else datetime.timezone.utc
    except Exception:
        tz = datetime.timezone.utc

    now = datetime.datetime.now(tz)

    if range_str == "today":
        if date_str:
            try:
                d = datetime.datetime.strptime(date_str, "%Y-%m-%d")
                local_day = d.replace(tzinfo=tz)
            except Exception:
                local_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            local_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        start_utc = local_day.astimezone(datetime.timezone.utc)
        end_utc = (local_day + datetime.timedelta(days=1)).astimezone(datetime.timezone.utc)
        raw = await ha_api.get_array_stats_chart(power_ids, kw_ids, start_utc, end_utc, "hour", tz, min_avg_w)
        points = _pad_hourly(_label_hourly(raw, tz), local_day, tz, now)

    elif range_str == "week":
        # Last 5 Sun-Sat weeks (current partial + 4 prior)
        days_since_sunday = (now.weekday() + 1) % 7
        this_sunday = (now - datetime.timedelta(days=days_since_sunday)).replace(
            hour=0, minute=0, second=0, microsecond=0)
        start_local = this_sunday - datetime.timedelta(weeks=4)
        start_utc = start_local.astimezone(datetime.timezone.utc)
        end_utc = now.astimezone(datetime.timezone.utc)
        raw = await ha_api.get_array_stats_chart(power_ids, kw_ids, start_utc, end_utc, "day", tz, min_avg_w)
        points = _aggregate_weekly(raw, tz)

    elif range_str == "month":
        # Current month + previous 11 (12 months total)
        month = now.month - 11
        year = now.year
        while month <= 0:
            month += 12
            year -= 1
        start_local = datetime.datetime(year, month, 1, tzinfo=tz)
        start_utc = start_local.astimezone(datetime.timezone.utc)
        end_utc = now.astimezone(datetime.timezone.utc)
        raw = await ha_api.get_array_stats_chart(power_ids, kw_ids, start_utc, end_utc, "month", tz, min_avg_w)
        points = _aggregate_monthly(raw, tz)

    else:  # year
        # All available years (up to 10 years back as a reasonable cap)
        start_local = datetime.datetime(max(now.year - 10, 2015), 1, 1, tzinfo=tz)
        start_utc = start_local.astimezone(datetime.timezone.utc)
        end_utc = now.astimezone(datetime.timezone.utc)
        raw = await ha_api.get_array_stats_chart(power_ids, kw_ids, start_utc, end_utc, "month", tz, min_avg_w)
        points = _aggregate_yearly(raw, tz)

    total_kwh = round(sum(p["kwh"] for p in points), 2)

    return web.Response(
        text=json.dumps({"range": range_str, "points": points, "total_kwh": total_kwh}),
        content_type="application/json",
    )


async def handle_api_about(request):
    ha_version = await ha_api.get_ha_version()
    mode = "Docker" if os.environ.get("HA_BASE_URL") else "Supervisor"
    return web.Response(
        text=json.dumps({
            "version": VERSION,
            "ha_version": ha_version,
            "mode": mode,
            "inverters_found": len(_inverters),
            "ha_tz": _ha_tz,
        }),
        content_type="application/json",
    )


# ── HTML template injection ───────────────────────────────────────────────

def _build_html(base: str) -> str:
    with open("/app/index.html", "r") as f:
        template = f.read()
    return template.replace("{{BASE}}", base).replace("{{VERSION}}", VERSION)


# ── Startup and app wiring ────────────────────────────────────────────────

async def on_startup(app):
    asyncio.ensure_future(refresh_loop())


def main():
    app = web.Application()
    app.on_startup.append(on_startup)

    app.router.add_get("/",                       handle_index)
    app.router.add_get("/icon.png",               handle_icon)
    app.router.add_get("/api/panels",             handle_api_panels)
    app.router.add_get("/api/sun",                handle_api_sun)
    app.router.add_get("/api/history",            handle_api_history)
    app.router.add_get("/api/layout",             handle_api_layout_get)
    app.router.add_post("/api/layout",            handle_api_layout_post)
    app.router.add_get("/api/settings",           handle_api_settings_get)
    app.router.add_post("/api/settings",          handle_api_settings_post)
    app.router.add_post("/api/rename",             handle_api_rename)
    app.router.add_post("/api/rediscover",        handle_api_rediscover)
    app.router.add_get("/api/about",              handle_api_about)
    app.router.add_get("/api/grid",               handle_api_grid_get)
    app.router.add_post("/api/grid",              handle_api_grid_post)
    app.router.add_get("/api/panel_detail",       handle_api_panel_detail)
    app.router.add_get("/api/panel_chart",        handle_api_panel_chart)
    app.router.add_get("/api/array_chart",        handle_api_array_chart)

    port = int(os.environ.get("INGRESS_PORT", 8100))
    _LOGGER.info("Solar Sentinel v%s starting on port %d", VERSION, port)
    web.run_app(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
