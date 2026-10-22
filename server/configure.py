#!/usr/bin/env python3
"""Guided settings changes, so nobody has to hand-edit JSON.

    scripts/configure.sh list
    scripts/configure.sh add-calendar
    scripts/configure.sh remove-calendar
    scripts/configure.sh add-camera
    scripts/configure.sh remove-camera
    scripts/configure.sh location
    scripts/configure.sh panchang

The secret calendar address is typed in hidden (like a password), so it
doesn't show on screen or end up in your shell history.
"""

import getpass
import json
import os
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import whatsup  # noqa: E402

PALETTE = [("blue", "#6AA9FF"), ("green", "#5ED39A"), ("orange", "#FF9F43"),
           ("pink", "#FF7A90"), ("purple", "#B9A7FF"), ("teal", "#4FD1C5")]
LABEL = "com.whatsup.dashboard"


def config_path() -> Path:
    return Path(os.environ.get("WHATSUP_CONFIG", whatsup.default_config_path()))


def load_raw(path: Path) -> dict:
    if not path.exists():
        sys.exit("No config file yet at %s — run scripts/install.sh first." % path)
    return json.loads(path.read_text(encoding="utf-8"))


def save_raw(path: Path, raw: dict) -> None:
    tmp = path.with_suffix(".tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(raw, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(str(tmp), str(path))
    os.chmod(str(path), 0o600)
    try:
        whatsup.load_config(path)  # validate what we wrote
    except whatsup.ConfigError as exc:
        print("Warning: the config now has a problem: %s" % exc)


def restart_service() -> None:
    if sys.platform != "darwin":
        return
    uid = os.getuid()
    res = subprocess.run(["launchctl", "kickstart", "-k", "gui/%d/%s" % (uid, LABEL)],
                         capture_output=True, text=True)
    if res.returncode == 0:
        print("Dashboard restarted with the new settings.")
    else:
        print("Saved. (The dashboard service isn't running; start it with scripts/install.sh.)")


def ask(prompt: str, default: str = "") -> str:
    suffix = " [%s]" % default if default else ""
    value = input("%s%s: " % (prompt, suffix)).strip()
    return value or default


def ask_yes(prompt: str, default: bool = True) -> bool:
    d = "Y/n" if default else "y/N"
    value = input("%s (%s): " % (prompt, d)).strip().lower()
    if not value:
        return default
    return value.startswith("y")


def real_calendars(raw: dict) -> list:
    return [c for c in raw.get("calendars", []) if "PASTE" not in str(c.get("ics_url", ""))]


def cmd_list(raw: dict) -> None:
    cals = real_calendars(raw)
    print("Location: %s (%s)" % (raw.get("location", {}).get("name", "?"), raw.get("location", {}).get("timezone", "?")))
    print("Calendars:")
    if not cals:
        print("  (none yet)")
    for i, c in enumerate(cals, 1):
        print("  %d. %s  colour %s  %s" % (i, c.get("name"), c.get("color"),
                                          "titles shown" if c.get("show_details", True) else "shown as Busy"))
    print("Cameras:")
    cams = raw.get("cameras", [])
    shown = [c for c in cams if c.get("youtube_video_id") or c.get("youtube_channel_id")]
    if not shown:
        print("  (none yet)")
    for i, c in enumerate(cams, 1):
        if c.get("youtube_video_id") or c.get("youtube_channel_id"):
            print("  %d. %s, %s" % (i, c.get("name"), c.get("place", "")))
    print("Panchang months: %s" % raw.get("panchang", {}).get("month_system", "purnimanta"))


def cmd_add_calendar(raw: dict) -> bool:
    print("\nIn Google Calendar (on the web): Settings → click the calendar on the left →")
    print("'Integrate calendar' → copy 'Secret address in iCal format'.")
    print("Only add family calendars — never a work calendar.\n")
    name = ask("Name to show on the dashboard", "Family")
    print("Colours: " + ", ".join("%d=%s" % (i + 1, n) for i, (n, _) in enumerate(PALETTE)))
    choice = ask("Colour number", "1")
    try:
        color = PALETTE[int(choice) - 1][1]
    except (ValueError, IndexError):
        color = PALETTE[0][1]
    show = ask_yes("Show event titles? (No = every event shows as 'Busy')", True)
    url = getpass.getpass("Paste the secret address (it stays hidden), then press Enter: ").strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "calendar.google.com":
        print("That doesn't look like a Google Calendar secret address (it should start with "
              "https://calendar.google.com/). Nothing was saved.")
        return False
    cals = real_calendars(raw)
    cals.append({"name": name[:40], "ics_url": url, "color": color, "show_details": show})
    raw["calendars"] = cals
    print("Added '%s'." % name)
    return True


def pick(items: list, what: str) -> int:
    for i, it in enumerate(items, 1):
        print("  %d. %s" % (i, it))
    value = ask("Number of the %s to remove (Enter to cancel)" % what, "")
    if not value:
        return -1
    try:
        idx = int(value) - 1
        if 0 <= idx < len(items):
            return idx
    except ValueError:
        pass
    print("Not a valid number.")
    return -1


def cmd_remove_calendar(raw: dict) -> bool:
    cals = real_calendars(raw)
    if not cals:
        print("No calendars to remove.")
        return False
    idx = pick([c.get("name") for c in cals], "calendar")
    if idx < 0:
        return False
    removed = cals.pop(idx)
    raw["calendars"] = cals
    print("Removed '%s'. Tip: in Google Calendar you can also 'Reset' the secret address so the old one stops working." % removed.get("name"))
    return True


YT_PATTERNS = [
    re.compile(r"[?&]v=([A-Za-z0-9_-]{11})"),
    re.compile(r"youtu\.be/([A-Za-z0-9_-]{11})"),
    re.compile(r"/(?:live|embed|shorts)/([A-Za-z0-9_-]{11})"),
]


def parse_youtube(text: str):
    text = text.strip()
    m = re.search(r"(UC[A-Za-z0-9_-]{22})", text)
    if m:
        return None, m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", text):
        return text, None
    for pat in YT_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1), None
    return None, None


def cmd_add_camera(raw: dict) -> bool:
    print("\nOpen the live stream on YouTube and copy its link from the address bar")
    print("(or Share → Copy link). A channel link containing 'UC…' also works.\n")
    name = ask("Short name for the button", "Golden Temple")
    place = ask("Place", "Amritsar")
    link = ask("YouTube link")
    vid, chan = parse_youtube(link)
    if not (vid or chan):
        print("Couldn't find a video or channel ID in that link. Nothing was saved.")
        return False
    cams = [c for c in raw.get("cameras", []) if c.get("youtube_video_id") or c.get("youtube_channel_id")]
    cams.append({"name": name[:40], "place": place[:40], "timezone": "Asia/Kolkata",
                 "youtube_video_id": vid or "", "youtube_channel_id": chan or ""})
    raw["cameras"] = cams
    print("Added camera '%s'." % name)
    return True


def cmd_remove_camera(raw: dict) -> bool:
    cams = [c for c in raw.get("cameras", []) if c.get("youtube_video_id") or c.get("youtube_channel_id")]
    if not cams:
        print("No cameras to remove.")
        return False
    idx = pick([c.get("name") for c in cams], "camera")
    if idx < 0:
        return False
    cams.pop(idx)
    raw["cameras"] = cams
    return True


def cmd_location(raw: dict) -> bool:
    loc = raw.setdefault("location", {})
    print("Find latitude/longitude by right-clicking a spot in Google Maps.")
    loc["name"] = ask("Place name", loc.get("name", "Groningen"))
    try:
        loc["latitude"] = float(ask("Latitude", str(loc.get("latitude", 53.2194))))
        loc["longitude"] = float(ask("Longitude", str(loc.get("longitude", 6.5665))))
    except ValueError:
        print("Latitude and longitude must be numbers. Nothing was saved.")
        return False
    loc["timezone"] = ask("Time zone", loc.get("timezone", "Europe/Amsterdam"))
    return True


def cmd_panchang(raw: dict) -> bool:
    current = raw.get("panchang", {}).get("month_system", "purnimanta")
    value = ask("Month system: purnimanta (North India) or amanta (South/West India)", current).lower()
    if value not in ("purnimanta", "amanta"):
        print("Please type purnimanta or amanta. Nothing was saved.")
        return False
    raw.setdefault("panchang", {})["month_system"] = value
    return True


COMMANDS = {
    "list": cmd_list,
    "add-calendar": cmd_add_calendar,
    "remove-calendar": cmd_remove_calendar,
    "add-camera": cmd_add_camera,
    "remove-camera": cmd_remove_camera,
    "location": cmd_location,
    "panchang": cmd_panchang,
}


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        return 1
    path = config_path()
    raw = load_raw(path)
    changed = COMMANDS[sys.argv[1]](raw)
    if changed:
        save_raw(path, raw)
        restart_service()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled. Nothing was changed.")
        sys.exit(1)
