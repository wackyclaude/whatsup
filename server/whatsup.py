#!/usr/bin/env python3
"""Whatsup — a small local server for the family dashboard.

What it does:
  * serves the dashboard page (static/) on http://127.0.0.1:<port>/ only
  * fetches Google Calendar (secret iCal addresses) and Open-Meteo weather
    in the background, and caches the last good result on disk
  * exposes two read-only JSON endpoints: /api/data and /api/settings

Security notes:
  * binds to 127.0.0.1 only, so other devices on the network can't reach it
  * rejects requests whose Host header isn't localhost (DNS-rebinding guard)
  * the secret calendar addresses never leave this process: they are not
    logged and not sent to the page
  * only GET/HEAD; nothing on the page can change settings

Written for the Python 3.9 that ships with macOS Command Line Tools.
"""

import argparse
import json
import logging
import mimetypes
import os
import re
import stat
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python < 3.9
    sys.exit("Python 3.9 or newer is required.")

APP_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = APP_DIR / "static"
FESTIVALS_FILE = APP_DIR / "config" / "festivals.json"
VERSION = "1.0.0"

log = logging.getLogger("whatsup")


# --------------------------------------------------------------------------
# Paths and configuration
# --------------------------------------------------------------------------

def default_config_path() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "whatsup" / "config.json"
    return Path.home() / ".config" / "whatsup" / "config.json"


def default_cache_path() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "whatsup" / "cache.json"
    return Path.home() / ".cache" / "whatsup" / "cache.json"


DEFAULTS: Dict[str, Any] = {
    "port": 8765,
    "location": {
        "name": "Groningen",
        "latitude": 53.2194,
        "longitude": 6.5665,
        "timezone": "Europe/Amsterdam",
    },
    "refresh_minutes": {"calendar": 15, "weather": 30},
    "calendars": [],
    "panchang": {"month_system": "purnimanta"},
    "cameras": [],
    "camera_rotate_minutes": 0,
}

HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")
YT_VIDEO = re.compile(r"^[A-Za-z0-9_-]{11}$")
YT_CHANNEL = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
ALLOWED_ICS_HOSTS = {"calendar.google.com"}


class ConfigError(Exception):
    pass


def load_config(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise ConfigError(
            "No config file at %s. Run scripts/install.sh, or copy "
            "config/config.example.json there." % path
        )
    warn_if_readable_by_others(path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ConfigError("Config file is not valid JSON (line %d): %s" % (exc.lineno, exc.msg))

    cfg = json.loads(json.dumps(DEFAULTS))  # deep copy
    for key, value in raw.items():
        if key.startswith("_"):
            continue  # comment keys in the example file
        if isinstance(value, dict) and isinstance(cfg.get(key), dict):
            cfg[key].update(value)
        else:
            cfg[key] = value
    validate_config(cfg)
    return cfg


def validate_config(cfg: Dict[str, Any]) -> None:
    loc = cfg["location"]
    try:
        lat, lon = float(loc["latitude"]), float(loc["longitude"])
    except (KeyError, TypeError, ValueError):
        raise ConfigError("location.latitude and location.longitude must be numbers")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ConfigError("location latitude/longitude out of range")
    try:
        ZoneInfo(loc["timezone"])
    except Exception:
        raise ConfigError("location.timezone '%s' is not a valid time zone" % loc.get("timezone"))

    port = cfg["port"]
    if not isinstance(port, int) or not (1024 <= port <= 65535):
        raise ConfigError("port must be a number between 1024 and 65535")

    real = []
    for cal in cfg["calendars"]:
        url = str(cal.get("ics_url", "")).strip() if isinstance(cal, dict) else ""
        if isinstance(cal, dict) and (not url or "PASTE" in url):
            log.info("Calendar '%s' has no address yet — skipping it. Add one with scripts/configure.sh add-calendar",
                     cal.get("name", "?"))
            continue
        real.append(cal)
    cfg["calendars"] = real

    for i, cal in enumerate(cfg["calendars"]):
        where = "calendars[%d]" % i
        if not isinstance(cal, dict):
            raise ConfigError("%s must be an object" % where)
        url = str(cal.get("ics_url", "")).strip()
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https":
            raise ConfigError("%s.ics_url must start with https://" % where)
        if parsed.hostname not in ALLOWED_ICS_HOSTS:
            raise ConfigError("%s.ics_url must be a calendar.google.com address" % where)
        color = cal.get("color", "#6AA9FF")
        if not HEX_COLOR.match(str(color)):
            raise ConfigError("%s.color must look like #6AA9FF" % where)
        cal.setdefault("name", "Calendar %d" % (i + 1))
        cal.setdefault("show_details", True)

    for i, cam in enumerate(cfg["cameras"]):
        where = "cameras[%d]" % i
        vid = str(cam.get("youtube_video_id", "") or "").strip()
        chan = str(cam.get("youtube_channel_id", "") or "").strip()
        if vid and not YT_VIDEO.match(vid):
            raise ConfigError("%s.youtube_video_id should be the 11-character ID after 'v=' in the YouTube link" % where)
        if chan and not YT_CHANNEL.match(chan):
            raise ConfigError("%s.youtube_channel_id should start with 'UC' and be 24 characters" % where)


def warn_if_readable_by_others(path: Path) -> None:
    try:
        mode = path.stat().st_mode
    except OSError:
        return
    if mode & (stat.S_IRWXG | stat.S_IRWXO):
        log.warning(
            "Config file %s can be read by other users on this Mac. "
            "Fix with: chmod 600 \"%s\"", path, path
        )


def public_settings(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Settings the page needs. Never includes calendar addresses."""
    cams = []
    for cam in cfg["cameras"]:
        vid = str(cam.get("youtube_video_id", "") or "").strip()
        chan = str(cam.get("youtube_channel_id", "") or "").strip()
        if not (vid or chan):
            continue
        cams.append({
            "name": str(cam.get("name", "Live camera"))[:40],
            "place": str(cam.get("place", ""))[:40],
            "timezone": str(cam.get("timezone", "Asia/Kolkata")),
            "youtube_video_id": vid,
            "youtube_channel_id": chan,
        })
    return {
        "version": VERSION,
        "mode": "local",
        "problems": [],
        "location": cfg["location"],
        "panchang": cfg["panchang"],
        "cameras": cams,
        "camera_rotate_minutes": cfg.get("camera_rotate_minutes", 0),
        "festivals": load_festivals(),
    }


def load_festivals() -> List[Dict[str, str]]:
    try:
        data = json.loads(FESTIVALS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Could not read festivals list: %s", exc)
        return []
    out = []
    for item in data.get("festivals", []):
        d, name = str(item.get("date", "")), str(item.get("name", ""))
        if re.match(r"^\d{4}-\d{2}-\d{2}$", d) and name:
            out.append({"date": d, "name": name[:40]})
    return out


# --------------------------------------------------------------------------
# Fetching (stdlib only, so it works with macOS's built-in Python)
# --------------------------------------------------------------------------

USER_AGENT = "whatsup-family-dashboard/%s" % VERSION
MAX_DOWNLOAD = 15 * 1024 * 1024  # 15 MB is plenty for a family calendar


def http_get(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosec - fixed https hosts
        data = resp.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise ValueError("download too large")
    return data


def safe_error(exc: Exception) -> str:
    """A short error message that never contains a URL (the calendar
    address is secret, and some exceptions include it)."""
    if isinstance(exc, urllib.error.HTTPError):
        return "HTTP %d" % exc.code
    if isinstance(exc, urllib.error.URLError):
        return "network error"
    msg = re.sub(r"https?://\S+", "<url>", str(exc))
    return (type(exc).__name__ + ": " + msg)[:160]


# --------------------------------------------------------------------------
# Calendar
# --------------------------------------------------------------------------

CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def clean_text(value: Any, limit: int = 120) -> str:
    text = CONTROL_CHARS.sub(" ", str(value or "")).strip()
    return text[:limit]


def fetch_calendar(cfg: Dict[str, Any], now: datetime) -> Dict[str, Any]:
    import icalendar  # imported here so --help works without the venv
    import recurring_ical_events

    tz = ZoneInfo(cfg["location"]["timezone"])
    today = now.astimezone(tz).date()
    start = datetime.combine(today, datetime.min.time(), tz)
    end = start + timedelta(days=3)

    events: List[Dict[str, Any]] = []
    errors: List[str] = []
    seen = set()
    for cal_cfg in cfg["calendars"]:
        try:
            cal = icalendar.Calendar.from_ical(http_get(cal_cfg["ics_url"]))
            occurrences = recurring_ical_events.of(cal).between(start, end)
        except Exception as exc:  # keep going with the other calendars
            errors.append("%s: %s" % (cal_cfg["name"], safe_error(exc)))
            continue
        for ev in occurrences:
            item = event_to_dict(ev, cal_cfg, tz)
            if item is None:
                continue
            key = (item["uid"], item["start"])
            if key in seen:
                continue
            seen.add(key)
            events.append(item)

    events.sort(key=lambda e: (e["start"], not e["all_day"], e["title"]))
    by_day: Dict[str, List[Dict[str, Any]]] = {}
    for e in events:
        for day in e.pop("days"):
            by_day.setdefault(day, []).append({k: v for k, v in e.items() if k != "uid"})

    days = [(today + timedelta(days=i)).isoformat() for i in range(3)]
    return {
        "today": by_day.get(days[0], []),
        "tomorrow": by_day.get(days[1], []),
        "errors": errors,
    }


def event_to_dict(ev: Any, cal_cfg: Dict[str, Any], tz: ZoneInfo) -> Optional[Dict[str, Any]]:
    if str(ev.get("STATUS", "")).upper() == "CANCELLED":
        return None
    dtstart = ev.get("DTSTART")
    if dtstart is None:
        return None
    s = dtstart.dt
    dtend = ev.get("DTEND")
    e = dtend.dt if dtend is not None else None

    all_day = not isinstance(s, datetime)
    if all_day:
        start_day = s
        end_day = e if isinstance(e, date) and e > s else s + timedelta(days=1)
        days, d = [], start_day
        while d < end_day:
            days.append(d.isoformat())
            d += timedelta(days=1)
        start_iso, end_iso = start_day.isoformat(), end_day.isoformat()
        start_label = end_label = ""
    else:
        if s.tzinfo is None:
            s = s.replace(tzinfo=tz)
        s = s.astimezone(tz)
        if isinstance(e, datetime):
            e = (e if e.tzinfo else e.replace(tzinfo=tz)).astimezone(tz)
        else:
            e = s
        days, d = [], s.date()
        last = (e - timedelta(seconds=1)).date() if e > s else s.date()
        while d <= last:
            days.append(d.isoformat())
            d += timedelta(days=1)
        start_iso, end_iso = s.isoformat(), e.isoformat()
        start_label, end_label = s.strftime("%H:%M"), e.strftime("%H:%M")

    private = str(ev.get("CLASS", "PUBLIC")).upper() in ("PRIVATE", "CONFIDENTIAL")
    show = bool(cal_cfg.get("show_details", True)) and not private
    title = clean_text(ev.get("SUMMARY")) if show else "Busy"
    return {
        "uid": clean_text(ev.get("UID"), 200),
        "start": start_iso,
        "end": end_iso,
        "start_label": start_label,
        "end_label": end_label,
        "all_day": all_day,
        "title": title or "(no title)",
        "busy": not show,
        "calendar": clean_text(cal_cfg["name"], 40),
        "color": cal_cfg.get("color", "#6AA9FF"),
        "days": days,
    }


# --------------------------------------------------------------------------
# Weather (Open-Meteo, free, no key)
# --------------------------------------------------------------------------

def weather_kind(code: Optional[int]) -> str:
    if code is None:
        return "cloud"
    if code in (0, 1):
        return "sun"
    if code == 2:
        return "partly"
    if code in (3, 45, 48):
        return "cloud"
    if code in (71, 73, 75, 77, 85, 86):
        return "snow"
    if code in (95, 96, 99):
        return "storm"
    return "rain"


def fetch_weather(cfg: Dict[str, Any], now: datetime) -> Dict[str, Any]:
    loc = cfg["location"]
    params = {
        "latitude": loc["latitude"],
        "longitude": loc["longitude"],
        "timezone": loc["timezone"],
        "forecast_days": 4,
        "hourly": "temperature_2m,precipitation_probability,precipitation,"
                  "wind_speed_10m,wind_direction_10m,weather_code",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,"
                 "precipitation_probability_max,precipitation_sum",
        "wind_speed_unit": "kmh",
    }
    url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(params)
    data = json.loads(http_get(url).decode("utf-8"))
    return parse_weather(data, now.astimezone(ZoneInfo(loc["timezone"])))


def parse_weather(data: Dict[str, Any], local_now: datetime) -> Dict[str, Any]:
    h = data["hourly"]
    current_hour = local_now.strftime("%Y-%m-%dT%H:00")
    times = h["time"]
    try:
        first = times.index(current_hour)
    except ValueError:
        first = 0
    hours = []
    for i in range(first, min(first + 13, len(times))):
        hours.append({
            "time": times[i],
            "label": "Now" if i == first else times[i][11:13],
            "temp": round(h["temperature_2m"][i]) if h["temperature_2m"][i] is not None else None,
            "rain": h["precipitation_probability"][i] or 0,
            "rain_mm": h["precipitation"][i] or 0,
            "wind": round(h["wind_speed_10m"][i] or 0),
            "wind_dir": h["wind_direction_10m"][i] or 0,
            "kind": weather_kind(h["weather_code"][i]),
        })

    d = data["daily"]
    days = []
    for i in range(min(3, len(d["time"]))):
        days.append({
            "date": d["time"][i],
            "max": round(d["temperature_2m_max"][i]),
            "min": round(d["temperature_2m_min"][i]),
            "rain": d["precipitation_probability_max"][i] or 0,
            "rain_mm": d["precipitation_sum"][i] or 0,
            "kind": weather_kind(d["weather_code"][i]),
        })
    return {"hours": hours, "today": days[0] if days else None, "next": days[1:3]}


# --------------------------------------------------------------------------
# Demo data (python whatsup.py --demo) so the page can be tried without setup
# --------------------------------------------------------------------------

def demo_data(now: datetime, tz: ZoneInfo) -> Dict[str, Any]:
    local = now.astimezone(tz)
    today = local.date()

    def ev(day_offset, hh, mm, dur_min, title, cal, color, busy=False):
        s = datetime(today.year, today.month, today.day, hh, mm, tzinfo=tz) + timedelta(days=day_offset)
        e = s + timedelta(minutes=dur_min)
        return {"start": s.isoformat(), "end": e.isoformat(), "start_label": s.strftime("%H:%M"),
                "end_label": e.strftime("%H:%M"), "all_day": False, "title": title, "busy": busy,
                "calendar": cal, "color": color}

    today_events = [
        {"start": today.isoformat(), "end": (today + timedelta(days=1)).isoformat(), "start_label": "",
         "end_label": "", "all_day": True, "title": "Sample birthday", "busy": False,
         "calendar": "Family", "color": "#6AA9FF"},
        ev(0, 7, 45, 30, "School drop-off", "Family", "#6AA9FF"),
        ev(0, 9, 0, 510, "Busy", "Family", "#5B6B7B", busy=True),
        ev(0, 15, 30, 60, "After-school activity", "Kids", "#5ED39A"),
        ev(0, 17, 0, 45, "Homework time", "Kids", "#5ED39A"),
        ev(0, 18, 30, 60, "Family dinner", "Family", "#6AA9FF"),
        ev(0, 20, 0, 30, "Video call with family", "Family", "#FF9F43"),
    ]
    temps = [8, 9, 10, 11, 12, 13, 13, 13, 12, 11, 10, 9, 9]
    rain = [0, 0, 10, 10, 20, 30, 40, 30, 20, 10, 10, 0, 0]
    wind = [12, 13, 15, 16, 18, 20, 22, 21, 19, 17, 15, 14, 12]
    hours = []
    base = local.replace(minute=0, second=0, microsecond=0)
    for i in range(13):
        t = base + timedelta(hours=i)
        hours.append({"time": t.strftime("%Y-%m-%dT%H:00"), "label": "Now" if i == 0 else t.strftime("%H"),
                      "temp": temps[i], "rain": rain[i], "rain_mm": 0.2 if rain[i] > 25 else 0,
                      "wind": wind[i], "wind_dir": 225 + i * 3, "kind": "partly"})
    return {
        "calendar": {"today": today_events,
                     "tomorrow": [ev(1, 8, 0, 60, "School event", "Kids", "#5ED39A")],
                     "errors": []},
        "weather": {"hours": hours,
                    "today": {"date": today.isoformat(), "max": 13, "min": 8, "rain": 40, "rain_mm": 2, "kind": "partly"},
                    "next": [
                        {"date": (today + timedelta(days=1)).isoformat(), "max": 12, "min": 7, "rain": 80, "rain_mm": 6, "kind": "rain"},
                        {"date": (today + timedelta(days=2)).isoformat(), "max": 11, "min": 6, "rain": 40, "rain_mm": 1, "kind": "cloud"},
                    ]},
    }


# --------------------------------------------------------------------------
# Background refresher + cache
# --------------------------------------------------------------------------

class DataStore:
    def __init__(self, cfg: Dict[str, Any], cache_path: Path, demo: bool = False):
        self.cfg = cfg
        self.cache_path = cache_path
        self.demo = demo
        self.lock = threading.Lock()
        self.state: Dict[str, Any] = {
            "calendar": None, "calendar_updated": None, "calendar_error": None,
            "weather": None, "weather_updated": None, "weather_error": None,
        }
        self._last_try = {"calendar": 0.0, "weather": 0.0}
        if not demo:
            self._load_cache()

    def _load_cache(self) -> None:
        try:
            cached = json.loads(self.cache_path.read_text(encoding="utf-8"))
            self.state.update({k: cached.get(k) for k in self.state})
            log.info("Loaded cached data from %s", self.cache_path)
        except (OSError, json.JSONDecodeError):
            pass

    def _save_cache(self) -> None:
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.cache_path.with_suffix(".tmp")
            fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(self.state, fh)
            os.replace(str(tmp), str(self.cache_path))
        except OSError as exc:
            log.warning("Could not write cache: %s", exc)

    def refresh(self, force: bool = False) -> None:
        now = datetime.now().astimezone()
        mins = self.cfg["refresh_minutes"]
        changed = False
        for kind, fetch in (("calendar", fetch_calendar), ("weather", fetch_weather)):
            if kind == "calendar" and not self.cfg["calendars"]:
                continue
            interval = max(5, int(mins.get(kind, 15))) * 60
            if not force and time.time() - self._last_try[kind] < interval:
                continue
            self._last_try[kind] = time.time()
            try:
                result = fetch(self.cfg, now)
                with self.lock:
                    self.state[kind] = result
                    self.state[kind + "_updated"] = now.isoformat(timespec="seconds")
                    self.state[kind + "_error"] = None
                changed = True
                log.info("Updated %s", kind)
            except Exception as exc:
                err = safe_error(exc)
                with self.lock:
                    self.state[kind + "_error"] = err
                log.warning("Could not update %s: %s", kind, err)
                self._last_try[kind] = time.time() - interval + 120  # retry in 2 min
        if changed:
            self._save_cache()

    def run_forever(self) -> None:
        last_day = None
        while True:
            today = datetime.now().date()
            self.refresh(force=(last_day is not None and today != last_day))
            last_day = today
            time.sleep(30)

    def snapshot(self) -> Dict[str, Any]:
        now = datetime.now().astimezone()
        if self.demo:
            tz = ZoneInfo(self.cfg["location"]["timezone"])
            data = demo_data(now, tz)
            stamp = now.isoformat(timespec="seconds")
            return {"demo": True, "calendar": data["calendar"], "weather": data["weather"],
                    "calendar_updated": stamp, "weather_updated": stamp,
                    "calendar_error": None, "weather_error": None,
                    "calendars_configured": True, "server_time": stamp}
        with self.lock:
            out = dict(self.state)
        out["demo"] = False
        out["calendars_configured"] = bool(self.cfg["calendars"])
        out["server_time"] = now.isoformat(timespec="seconds")
        return out


# --------------------------------------------------------------------------
# HTTP server
# --------------------------------------------------------------------------

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; "
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com"
)


class Handler(BaseHTTPRequestHandler):
    server_version = "whatsup"
    sys_version = ""
    store: DataStore = None  # type: ignore
    settings: Dict[str, Any] = {}
    allowed_hosts: set = set()

    def log_message(self, fmt: str, *args: Any) -> None:  # quieter logs
        log.debug("%s - %s", self.address_string(), fmt % args)

    def _headers(self, status: int, ctype: str, length: int, cache: str = "no-store") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", cache)
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.end_headers()

    def _send(self, status: int, body: bytes, ctype: str, head_only: bool = False) -> None:
        self._headers(status, ctype, len(body))
        if not head_only:
            self.wfile.write(body)

    def _json(self, obj: Any, head_only: bool = False) -> None:
        self._send(200, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8", head_only)

    def do_HEAD(self) -> None:
        self.do_GET(head_only=True)

    def do_GET(self, head_only: bool = False) -> None:
        host = (self.headers.get("Host") or "").lower()
        if host not in self.allowed_hosts:
            self._send(HTTPStatus.FORBIDDEN, b"Forbidden", "text/plain; charset=utf-8", head_only)
            return
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/data":
            self._json(self.store.snapshot(), head_only)
            return
        if path == "/api/settings":
            self._json(self.settings, head_only)
            return
        if path in ("/", "/index.html"):
            path = "/index.html"
        self._static(path, head_only)

    def _static(self, path: str, head_only: bool) -> None:
        rel = path.lstrip("/")
        if not re.match(r"^[A-Za-z0-9_\-./]+$", rel) or ".." in rel:
            self._send(404, b"Not found", "text/plain; charset=utf-8", head_only)
            return
        target = (STATIC_DIR / rel).resolve()
        try:
            target.relative_to(STATIC_DIR.resolve())
        except ValueError:
            self._send(404, b"Not found", "text/plain; charset=utf-8", head_only)
            return
        if not target.is_file():
            self._send(404, b"Not found", "text/plain; charset=utf-8", head_only)
            return
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        body = target.read_bytes()
        self._send(200, body, ctype, head_only)


def serve(cfg: Dict[str, Any], cache_path: Path, demo: bool) -> None:
    store = DataStore(cfg, cache_path, demo=demo)
    port = cfg["port"]
    Handler.store = store
    Handler.settings = public_settings(cfg)
    Handler.allowed_hosts = {"127.0.0.1:%d" % port, "localhost:%d" % port}
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("application/manifest+json", ".webmanifest")

    if not demo:
        threading.Thread(target=store.run_forever, name="refresher", daemon=True).start()

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    log.info("Dashboard running at http://127.0.0.1:%d/%s", port, "  (demo data)" if demo else "")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log.info("Stopping")


def check(cfg: Dict[str, Any]) -> int:
    """Fetch everything once and print a summary (no secrets printed)."""
    now = datetime.now().astimezone()
    ok = True
    print("Config OK. Location: %s (%s)" % (cfg["location"]["name"], cfg["location"]["timezone"]))
    if cfg["calendars"]:
        try:
            cal = fetch_calendar(cfg, now)
            print("Calendar: %d event(s) today, %d tomorrow." % (len(cal["today"]), len(cal["tomorrow"])))
            for err in cal["errors"]:
                ok = False
                print("  Problem with %s" % err)
        except Exception as exc:
            ok = False
            print("Calendar: FAILED — %s" % safe_error(exc))
    else:
        print("Calendar: none configured yet (that's fine for a first test).")
    try:
        wx = fetch_weather(cfg, now)
        t = wx["today"]
        print("Weather: today %s° / %s°, %d hourly points." % (t["max"], t["min"], len(wx["hours"])))
    except Exception as exc:
        ok = False
        print("Weather: FAILED — %s" % safe_error(exc))
    print("Cameras: %d configured." % len(public_settings(cfg)["cameras"]))
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="Family dashboard local server")
    ap.add_argument("--config", type=Path, default=Path(os.environ.get("WHATSUP_CONFIG", default_config_path())))
    ap.add_argument("--cache", type=Path, default=default_cache_path())
    ap.add_argument("--demo", action="store_true", help="serve sample calendar and weather data")
    ap.add_argument("--check", action="store_true", help="test the config and data sources, then exit")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    try:
        if args.demo and not args.config.exists():
            cfg = json.loads(json.dumps(DEFAULTS))
        else:
            cfg = load_config(args.config)
    except ConfigError as exc:
        log.error("%s", exc)
        return 2
    if args.check:
        return check(cfg)
    serve(cfg, args.cache, args.demo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
