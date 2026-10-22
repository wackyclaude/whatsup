"""Tests for the guided settings helper."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import configure  # noqa: E402


class YoutubeLinkTests(unittest.TestCase):
    def test_links(self):
        cases = {
            "https://www.youtube.com/watch?v=abcDEF12345&t=3": ("abcDEF12345", None),
            "https://youtu.be/abcDEF12345?si=xyz": ("abcDEF12345", None),
            "https://www.youtube.com/live/abcDEF12345?feature=share": ("abcDEF12345", None),
            "abcDEF12345": ("abcDEF12345", None),
            "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv": (None, "UCabcdefghijklmnopqrstuv"),
            "https://www.youtube.com/@somechannel": (None, None),
        }
        for link, expected in cases.items():
            self.assertEqual(configure.parse_youtube(link), expected, link)


if __name__ == "__main__":
    unittest.main()
