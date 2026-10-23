# Vendored libraries

Kept in the repo so the dashboard works offline and loads nothing from third-party CDNs.

| File | Library | Version | Licence | Source |
|---|---|---|---|---|
| `suncalc.js` | SunCalc (ES module build) | 2.1.1 | BSD-2-Clause (`LICENSE-suncalc.txt`) | https://github.com/mourner/suncalc |
| `astronomy.js` | Astronomy Engine (ES module build) | 2.1.19 | MIT (header of the file) | https://github.com/cosinekitty/astronomy |
| `satellite.es.js` | satellite.js (ES module build, Space Station passes) | 5.0.0 | MIT (`LICENSE-satellite.txt`) | https://github.com/shashwatak/satellite-js |

To update: `npm pack suncalc astronomy-engine satellite.js`, copy `index.js` → `suncalc.js`, `esm/astronomy.js` → `astronomy.js` and `dist/satellite.es.js` → `satellite.es.js`, then run `TZ=Europe/Amsterdam node tests/test_sky.mjs` and `tests/test_night.mjs`.
