# SkyPanel

A DIY WiFi LED flight tracker: a 64×32 RGB matrix that shows the nearest aircraft in
real time — airline name in its brand colour, route, aircraft type, altitude, speed and
distance.

```
┌────────────────────────────────────────────────────────────┐
│ RYANAIR                                                  ● │
│ FR1812  DUB→STN  B738                                      │
│ 24,000FT  410KT  6.1MI                                     │
└────────────────────────────────────────────────────────────┘
```

## What's here

| Path | What it is |
|---|---|
| `backend/` | Python 3.12 / FastAPI service. Talks to ADS-B feeds, enriches, caches, and emits a *semantic* display frame. |
| `firmware/` | C++17 for an ESP32-S3 MatrixPortal. `lib/render/` is shared with the emulator and compiles for both targets. |
| `emulator/` | SDL2 desktop host running the **same** renderer, with LED-dot simulation, gamma, bloom and headless PNG snapshots. |
| `docs/` | Hardware BOM & wiring, architecture, operations. |
| `deploy/` | systemd unit + docker-compose for the Pi. |

## The core idea

The emulator is not a mock. `lib/render/Renderer.cpp` draws into an `Adafruit_GFX`
`GFXcanvas16`. That canvas is then blitted to *either* a HUB75 panel or an SDL2 window.
One renderer, two backends — what you see on the laptop is what lights up on the panel.

The backend never sends pixels. It sends this:

```json
{
  "mode": "nearest",
  "source": "local",
  "lines": [
    {"text": "RYANAIR", "colour": "#073590", "style": "title", "scroll": "auto"},
    {"text": "FR1812  DUB→STN  B738", "colour": "#c8c8c8", "style": "body"},
    {"text": "24,000FT  410KT  6.1MI", "colour": "#808080", "style": "body"}
  ],
  "status": "live"
}
```

Units, colours, route formatting and field selection are all applied server-side from
user settings. The firmware contains no business logic.

## Quick start

```bash
# Backend (mock source — no receiver needed)
cd backend
uv sync
uv run skypanel-serve            # http://localhost:8000

# Emulator
cd ../emulator
cmake -B build -S . && cmake --build build -j
./build/skypanel-emu --backend http://localhost:8000
```

Point it at a real receiver by editing `backend/config.toml`:

```toml
[source]
mode = "local"
local_host = "raspberrypi.local"
```

## Development

```bash
just            # list tasks
just test       # backend pytest + native renderer tests + snapshot tests
just lint       # ruff + mypy --strict
just snapshots  # re-render golden PNGs
```

## Data attribution

Aggregator feeds carry licence obligations. adsb.lol is ODbL; adsb.fi requires
attribution and is non-commercial. The settings UI and `/api/frame` both name the
provider serving each frame — don't remove that.

Airport data from [OurAirports](https://ourairports.com/data/) (public domain).
Route and aircraft enrichment from [adsbdb.com](https://www.adsbdb.com).
