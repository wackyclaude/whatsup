"""Tests for the local server. Run with:  .venv/bin/python -m unittest discover tests"""

import json
import sys
import tempfile
import threading
import unittest
import urllib.request
from datetime import datetime
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import whatsup  # noqa: E402

TZ = ZoneInfo("Europe/Amsterdam")

ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:weekly-1
DTSTART;TZID=Europe/Amsterdam:20261001T153000
DTEND;TZID=Europe/Amsterdam:20261001T163000
RRULE:FREQ=WEEKLY;BYDAY=TH
SUMMARY:Swimming <b>lesson</b>
END:VEVENT
BEGIN:VEVENT
UID:private-1
DTSTART;TZID=Europe/Amsterdam:20261022T090000
DTEND;TZID=Europe/Amsterdam:20261022T173000
CLASS:PRIVATE
SUMMARY:Doctor appointment
END:VEVENT
BEGIN:VEVENT
UID:allday-1
DTSTART;VALUE=DATE:20261022
DTEND;VALUE=DATE:20261023
SUMMARY:Birthday
END:VEVENT
BEGIN:VEVENT
UID:tomorrow-1
DTSTART:20261023T060000Z
DTEND:20261023T070000Z
SUMMARY:School trip
END:VEVENT
BEGIN:VEVENT
UID:cancelled-1
DTSTART;TZID=Europe/Amsterdam:20261022T120000
DTEND;TZID=Europe/Amsterdam:20261022T130000
STATUS:CANCELLED
SUMMARY:Cancelled lunch
END:VEVENT
END:VCALENDAR
"""


def make_cfg(**overrides):
    cfg = json.loads(json.dumps(whatsup.DEFAULTS))
    cfg["calendars"] = [{"name": "Family", "ics_url": "https://calendar.google.com/calendar/ical/x/private-y/basic.ics",
                         "color": "#6AA9FF", "show_details": True}]
    cfg.update(overrides)
    return cfg


class CalendarTests(unittest.TestCase):
    def test_today_events(self):
        now = datetime(2026, 10, 22, 7, 42, tzinfo=TZ)
        with mock.patch.object(whatsup, "http_get", return_value=ICS):
            cal = whatsup.fetch_calendar(make_cfg(), now)
        titles = [e["title"] for e in cal["today"]]
        self.assertEqual(titles, ["Birthday", "Busy", "Swimming <b>lesson</b>"])
        swim = cal["today"][2]
        self.assertEqual((swim["start_label"], swim["end_label"]), ("15:30", "16:30"))
        busy = cal["today"][1]
        self.assertTrue(busy["busy"])
        self.assertNotIn("Doctor", json.dumps(cal))  # private details never leave the server
        self.assertEqual([e["title"] for e in cal["tomorrow"]], ["School trip"])
        self.assertEqual(cal["tomorrow"][0]["start_label"], "08:00")
        self.assertEqual(cal["errors"], [])

    def test_hide_details(self):
        cfg = make_cfg()
        cfg["calendars"][0]["show_details"] = False
        now = datetime(2026, 10, 22, 7, 42, tzinfo=TZ)
        with mock.patch.object(whatsup, "http_get", return_value=ICS):
            cal = whatsup.fetch_calendar(cfg, now)
        self.assertTrue(all(e["title"] == "Busy" for e in cal["today"]))

    def test_errors_hide_url(self):
        def boom(url, timeout=20):
            raise ValueError("failed for " + url)
        now = datetime(2026, 10, 22, 7, 42, tzinfo=TZ)
        with mock.patch.object(whatsup, "http_get", side_effect=boom):
            cal = whatsup.fetch_calendar(make_cfg(), now)
        self.assertEqual(len(cal["errors"]), 1)
        self.assertNotIn("calendar.google.com", cal["errors"][0])


class WeatherTests(unittest.TestCase):
    def test_parse(self):
        times = ["2026-10-22T%02d:00" % h for h in range(24)] + ["2026-10-23T%02d:00" % h for h in range(24)]
        n = len(times)
        data = {
            "hourly": {"time": times, "temperature_2m": [10.4] * n, "precipitation_probability": [30] * n,
                       "precipitation": [0.1] * n, "wind_speed_10m": [18.2] * n, "wind_direction_10m": [225] * n,
                       "weather_code": [61] * n},
            "daily": {"time": ["2026-10-22", "2026-10-23", "2026-10-24"], "weather_code": [2, 61, 3],
                      "temperature_2m_max": [13.2, 12, 11], "temperature_2m_min": [7.6, 7, 6],
                      "precipitation_probability_max": [40, 80, 40], "precipitation_sum": [2, 6, 1]},
        }
        wx = whatsup.parse_weather(data, datetime(2026, 10, 22, 7, 42, tzinfo=TZ))
        self.assertEqual(len(wx["hours"]), 13)
        self.assertEqual(wx["hours"][0]["label"], "Now")
        self.assertEqual(wx["hours"][1]["label"], "08")
        self.assertEqual(wx["hours"][0]["kind"], "rain")
        self.assertEqual((wx["today"]["max"], wx["today"]["min"]), (13, 8))
        self.assertEqual([d["kind"] for d in wx["next"]], ["rain", "cloud"])


class ConfigTests(unittest.TestCase):
    def write(self, obj):
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(obj, tmp)
        tmp.close()
        return Path(tmp.name)

    def test_example_loads_without_calendars(self):
        example = Path(__file__).resolve().parent.parent / "config" / "config.example.json"
        cfg = whatsup.load_config(example)
        self.assertEqual(cfg["calendars"], [])  # placeholder entry is skipped, not an error
        self.assertEqual(whatsup.public_settings(cfg)["cameras"], [])  # cameras without IDs are hidden

    def test_only_google_https(self):
        for url in ("http://calendar.google.com/x.ics", "https://evil.example.com/x.ics"):
            path = self.write({"calendars": [{"name": "A", "ics_url": url}]})
            with self.assertRaises(whatsup.ConfigError):
                whatsup.load_config(path)

    def test_camera_ids_validated(self):
        path = self.write({"calendars": [], "cameras": [{"name": "X", "youtube_video_id": "bad id"}]})
        with self.assertRaises(whatsup.ConfigError):
            whatsup.load_config(path)

    def test_settings_hide_calendar_urls(self):
        path = self.write({"calendars": [{"name": "A", "ics_url": "https://calendar.google.com/secret123.ics"}],
                           "cameras": [{"name": "Cam", "youtube_video_id": "abcdefghijk"},
                                       {"name": "Empty"}]})
        cfg = whatsup.load_config(path)
        settings = whatsup.public_settings(cfg)
        self.assertNotIn("secret123", json.dumps(settings))
        self.assertEqual([c["name"] for c in settings["cameras"]], ["Cam"])
        self.assertTrue(len(settings["festivals"]) > 10)


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cfg = json.loads(json.dumps(whatsup.DEFAULTS))
        store = whatsup.DataStore(cfg, Path(tempfile.mkdtemp()) / "cache.json", demo=True)
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), whatsup.Handler)
        port = cls.httpd.server_address[1]
        whatsup.Handler.store = store
        whatsup.Handler.settings = whatsup.public_settings(cfg)
        whatsup.Handler.allowed_hosts = {"127.0.0.1:%d" % port, "localhost:%d" % port}
        cls.base = "http://127.0.0.1:%d" % port
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def get(self, path, host=None):
        req = urllib.request.Request(self.base + path)
        if host:
            req.add_header("Host", host)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers

    def test_index_and_headers(self):
        status, body, headers = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b"<html", body)
        self.assertIn("frame-src", headers["Content-Security-Policy"])

    def test_data(self):
        status, body, _ = self.get("/api/data")
        data = json.loads(body)
        self.assertTrue(data["demo"])
        self.assertEqual(len(data["weather"]["hours"]), 13)

    def test_rejects_foreign_host(self):
        status, _, _ = self.get("/api/data", host="evil.example.com")
        self.assertEqual(status, 403)

    def test_no_path_traversal(self):
        for p in ("/../server/whatsup.py", "/%2e%2e/server/whatsup.py", "/static/../../server/whatsup.py"):
            status, _, _ = self.get(p)
            self.assertEqual(status, 404, p)


if __name__ == "__main__":
    unittest.main()
