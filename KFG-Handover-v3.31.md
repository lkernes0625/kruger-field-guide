# Kruger Field Guide — Handover Notes v3.31
*For use at the start of a new Claude session*

---

## Live URLs

| Resource | URL |
|---|---|
| App | https://app.krantzoutdoors.com |
| App repo | https://github.com/lkernes0625/kruger-field-guide |
| Data repo | https://github.com/lkernes0625/kruger-live |
| Licenses repo | https://github.com/lkernes0625/kfg-licenses (private) |
| Vercel functions | https://kruger-feed-function.vercel.app |

---

## Current Version
**v3.31** — deploy `kruger-field-guide-v3_31.html` renamed to `kruger-field-guide.html` in the app repo, then update `version.json` in kruger-live to `{"version":"3.31"}`

---

## Tech Stack
- Single HTML file, vanilla JS, no frameworks
- Montserrat font (Google Fonts)
- Firebase: `kruger-feed-default-rtdb.europe-west1.firebasedatabase.app`
- Vercel: `kruger-feed-function.vercel.app/api/validate` and `/api/add-key`
- Make scenario: Etsy → key generation → GitHub → email

---

## Critical Rules — NEVER Break These

### Nav Safe Area (iOS PWA)
```css
#nav { padding-bottom: env(safe-area-inset-bottom, 0px) }
```
**Do NOT add `viewport-fit=cover` to the viewport meta tag.** This was the root cause of the original bottom gap bug.

### Adding New Species — THE CORRECT METHOD
**This has caused bugs across multiple builds. Follow exactly:**

1. Add image to `ANIMAL_IMG`: `"your_id": "data:image/png;base64,..."`
2. Add entry to `SPECIES` array **using bracket-depth tracking** to find the insertion point:
```python
# Find SPECIES array end by tracking brackets
sp_start = js.find('var SPECIES = [')
depth = 0
sp_end = -1
for i, ch in enumerate(js[sp_start:], sp_start):
    if ch == '[': depth += 1
    elif ch == ']':
        depth -= 1
        if depth == 0:
            sp_end = i  # position of the ] character
            break
# Insert BEFORE sp_end:
js_new = js[:sp_end] + ',\n  { id:"your_id", ...entry... }\n' + js[sp_end:]
```
3. **VERIFY with Node.js eval** — this is mandatory:
```javascript
// In Node.js, actually evaluate the SPECIES array
eval(speciesJS);
console.log('SPECIES.length:', SPECIES.length); // Must equal expected count
```

**WHY:** The `SPECIES` array is immediately followed by `var RARE_SPECIES = [` in the file. Using `js.find('\n];')` finds the RARE_SPECIES closing instead. All species from v3.26–v3.28 were silently inserted into RARE_SPECIES and invisible to `renderSpecies()`. Bracket-depth tracking is the only reliable method.

4. Add language names to `SPECIES_LANGUAGES` object (6 languages: af, zu, ts, fr, de, es)
5. **Birds** go in `BIRDS` array. **Reptiles** in `REPTILES`. **Frogs** in `FROGS`.

---

## Current Species Counts

| Array | Count | Notes |
|---|---|---|
| `SPECIES` (mammals) | **70** | Verified by Node.js eval |
| `BIRDS` | 3 | fish_eagle, pels_fishing_owl, southern_ground_hornbill |
| `REPTILES` | 4 | crocodile, leopard_tortoise, monitor_lizard, african_rock_python |
| `FROGS` | 5 | african_bullfrog, foam_nest_frog, painted_reed_frog, natal_dwarf_puddle_frog, bubbling_kassina |
| `ANIMAL_IMG` | **82 images** | All mammals + birds + reptiles + frogs |
| `RARE_SPECIES` | 4 | Finder helper only — NOT the main species array |

---

## Firebase Structure

```
kruger-feed-default-rtdb.europe-west1.firebasedatabase.app
├── /feed                    → Live feed posts (read/write)
├── /road_reports            → Road condition reports
├── /sightings               → Logged wildlife sightings
├── /trips                   → Saved trip plans
├── /journals                → Trip journal entries
└── /app_config
    ├── /fees                → SANParks entrance fees (update annually in April)
    └── /gate_times          → Optional seasonal gate time override
```

### Fees Structure (update in April each year)
```json
{
  "lastUpdated": "April 2026",
  "conservation": [
    {"label": "SA Citizen adult", "amount": "R216"},
    {"label": "SA Citizen child (2-11)", "amount": "R108"},
    {"label": "SADC resident adult", "amount": "R312"},
    {"label": "SADC resident child", "amount": "R156"},
    {"label": "International adult", "amount": "R552"},
    {"label": "International child", "amount": "R276"}
  ],
  "vehicle": [
    {"label": "SA registered vehicle", "amount": "R50/day"},
    {"label": "Foreign registered vehicle", "amount": "R100/day"}
  ],
  "wildcard": "Individual ~R2,400/year | Cluster ~R3,200/year | Family Cluster ~R4,500/year"
}
```

---

## Auto-Updating Features (No Manual Work Needed)

| Feature | How it updates |
|---|---|
| **Gate times** | `GATE_SEASONAL` table in app — reads device's current month, picks correct seasonal close time automatically |
| **Fees** | Fetches from Firebase `/app_config/fees` on every open. Falls back to hardcoded April 2025 values if offline. Update Firebase JSON in April each year. |
| **App version** | `version.json` in kruger-live repo. When bumped, app detects mismatch and auto-reloads with `?v=Date.now()` (timestamp URL forces fresh cache) |

---

## Camp & Location Data

| Dataset | Count | Notes |
|---|---|---|
| `CAMPS` | 35 | Full SANParks classification + new detail fields |
| `FACILITIES.lookout` | ~14 | Includes hides with `amenities:['hide']` |
| `FACILITIES.dams` | 36 | Includes waterholes (`type:'waterhole'`), dam+hide duals |
| `FACILITIES.landmarks` | ~15 | Heritage + POI (`type:'poi'`) |
| `FACILITIES.gate` | 9 | All park gates with coordinates |
| `FACILITIES.toilet` | ~12 | Picnic sites |

### Camp Classification (SANParks verified)
- **Main Camps (12):** Berg-en-Dal, Crocodile Bridge, Letaba, Lower Sabie, Mopani, Olifants, Orpen, Pretoriuskop, Punda Maria, Satara, Shingwedzi, Skukuza
- **Satellite Camps (4):** Balule, Malelane, Maroela, Tamboti
- **Bushveld Camps (5):** Bateleur, Biyamiti, Shimuwini, Sirheni, Talamati
- **Bush Lodges (3):** Boulders, Pafuri Border Camp, Roodewal
- **Overnight Hides (2):** Shipandani, Kanniedood
- **Tented/Camping (1):** Tsendze

**NOTE:** andBeyond Kirkman's Kamp is NOT in Kruger — it's Sabi Sand. It was removed.

---

## Key Functions Reference

| Function | Purpose |
|---|---|
| `renderSpecies()` | Renders mammal grid/list. Reads `_wildlifeFilter`, `_wildlifeViewMode`, `_azFilter` |
| `renderCamps()` | Renders camp cards. Uses `campSearch`, `campZoneFilter`, `campTypeFilter` |
| `renderLookouts()` | Renders lookouts + hides from dams via `fromDam` flag |
| `renderDams()` | Renders dams + waterholes. `setDamFilter('dam'/'waterhole')` |
| `renderLandmarks()` | Renders Heritage + POI. `setLandmarkFilter('heritage'/'poi')` |
| `toggleWildlifeView()` | Toggles `_wildlifeViewMode` grid↔list, persists to localStorage |
| `buildAZIndex()` | Builds A–Z sidebar from SPECIES names |
| `setAZFilter(letter)` | Filters mammals to letter, calls `renderSpecies()` |
| `fetchFeesFromFirebase(container)` | Fetches fees from Firebase, renders into About Kruger modal |
| `openSpecies(idx)` | Opens species detail sheet. `SPECIES[idx]` |
| `forceUpdate()` | Hard reload with timestamp URL — breaks all caches |
| `checkForUpdate()` | Polls version.json, triggers auto-reload if mismatch |
| `initApp()` | App startup — called after license validation |

---

## Version Bump Procedure (every build)
Replace all of these:
```
APP_VERSION = '3.31'  →  APP_VERSION = '3.32'
Kruger Field Guide v3.31  →  Kruger Field Guide v3.32
>v3.31<  →  >v3.32<
v3.31 — BUILD NOTES  →  v3.32 — BUILD NOTES
v3.31<br>  →  v3.32<br>
'Content v3.31  →  'Content v3.32
```
Then update `version.json` to `{"version":"3.32"}` after deploying.

---

## PWA Cache Management
The app uses a layered cache-bust strategy:
1. **`kfg_build` localStorage** — on every `initApp()`, stored build is compared to `APP_VERSION`. If different, `window.location.replace(url + '?v=' + Date.now())` forces a fresh fetch.
2. **`checkForUpdate()`** — polls `version.json` every app open. If version mismatch, shows countdown banner and auto-reloads after 5 seconds.
3. **No service worker** — intentionally absent to avoid cache complexity.

**To force all users to get a new build:** deploy file + update `version.json`. Users will get it within 5 seconds of next app open.

---

## Outstanding Items
- ⬜ Hard key expiry server-side
- ⬜ Push notifications when app closed (FCM)
- ⬜ Species expansion target: ~328 (mammals 80, birds 180, reptiles 40, frogs 28)
- ⬜ Camp maps (agreed to do on a future build — show Skukuza example first)
- ⬜ More camp details still needed for Luxury Lodge entries
- ⬜ Family Group Feed (removed from v3.26, may return)
- ⬜ Firebase rules — apply `firebase-rules.json` to Firebase Console

---

## Demo Keys
- `KRANTZ-DEMO-2026` — hardcoded in HTML for internal testing
- All real keys in `kfg-licenses/keys.json` (private repo)
- License validation: `https://kruger-feed-function.vercel.app/api/validate`
- GitHub token in Vercel env vars, expires May 2027

---

## Known Issues History (resolved)
| Issue | Root Cause | Fix |
|---|---|---|
| Animals not showing (v3.26–v3.29) | New species inserted into `RARE_SPECIES` instead of `SPECIES` — `js.find('\n];')` matched wrong array | Bracket-depth tracking + Node.js eval verification |
| Bottom nav gap (iPhone PWA) | `viewport-fit=cover` added in v3.23 while `padding-bottom:env(safe-area-inset-bottom)` removed | Removed `viewport-fit=cover` entirely |
| Dropdown scroll blocked | `#content` has `overflow-x:hidden` which clips `position:absolute` children on iOS | Changed dropdown to `position:fixed` with `getBoundingClientRect()` positioning |
| JS syntax errors (v3.26) | Smart/curly quotes in string concatenation | Rewrote to use DOM methods |
| Clock showed running at midnight | `diff = close - now` was positive even before gate opened | Added `isClosed = (diff <= 0) \|\| (now < openTime)` check |

---

## File Locations (in Claude's working environment)
Working file: `/home/claude/kruger-v3_31.html`  
Output: `/mnt/user-data/outputs/kruger-field-guide-v3_31.html`

Previous working files also available:
- `/home/claude/kruger-v3_30.html` (previous stable)
- `/home/claude/kruger-v3_29.html`
- `/home/claude/kruger-v3_28.html`
