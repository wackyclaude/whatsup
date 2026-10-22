# Vendored libraries

Kept in the repo so the dashboard works offline and loads nothing from third-party CDNs.

| File | Library | Version | Licence | Source |
|---|---|---|---|---|
| `suncalc.js` | SunCalc (ES module build) | 2.1.1 | BSD-2-Clause (`LICENSE-suncalc.txt`) | https://github.com/mourner/suncalc |
| `astronomy.js` | Astronomy Engine (ES module build) | 2.1.19 | MIT (header of the file) | https://github.com/cosinekitty/astronomy |

To update: `npm pack suncalc astronomy-engine`, copy `index.js` → `suncalc.js` and `esm/astronomy.js` → `astronomy.js`, then run `TZ=Europe/Amsterdam node tests/test_sky.mjs`.
