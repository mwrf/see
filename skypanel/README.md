# SkyPanel

A 64×32 LED matrix that shows the nearest aircraft overhead: the airline in its
brand colour, then the flight number, route and type, then altitude, speed and
distance.

```
  ┌────────────────────────────────────────┐
  │            R Y A N A I R               │   ← airline, in its brand colour
  │    FR1812  DUB→STN  B738               │   ← flight, route, type
  │    24,000FT  410KT  6.1MI              │   ← altitude, speed, distance
  └────────────────────────────────────────┘
```

An ESP32 drives the panel and polls one URL. Everything else — which aircraft,
what the lines say, which units, what colour — is decided by a Python service
on the LAN.

## How it fits together

```
  ADS-B receiver            SkyPanel backend                MatrixPortal S3
  (dump1090 / readsb)  ->   poll, enrich, select      ->    GET /api/frame
  or a public API           /api/frame                      render, scroll
                                                            buttons, OTA
                                    |
                            settings page + dashboard
```

Four things shape the design:

1. **The emulator is not a mock.** It compiles the firmware's own renderer,
   fonts and poll loop natively and blits the same `GFXcanvas16` to SDL, a PNG
   or a GIF. No renderer is written twice, so what looks right on a laptop is
   right on the panel.
2. **Two interchangeable feeds.** A local receiver and a public aggregator
   implement one interface; the choice is config. A third replays fixtures for
   offline work.
3. **Thin firmware, smart backend.** The device does display, buttons and
   WiFi. API calls, enrichment, caching and unit conversion happen on the Pi.
4. **Everything testable on a laptop.** 275 backend tests and 114 native
   render tests, including 13 golden images. None touch the network; none need
   a display server.

## Quick start

You do not need any hardware to try this.

```bash
just setup                                   # backend venv
just build                                   # emulator + tests
just show ryanair                            # a window, if you have SDL2
just snapshot ryanair /tmp/panel.png         # or a PNG, if you don't
```

Then run the backend against the recorded fixtures and point the emulator at
it:

```bash
cp config.example.toml config.toml
sed -i 's/^mode = .*/mode = "mock"/' config.toml
just serve &
just emu --backend http://localhost:8000
```

Open <http://localhost:8000/> for the settings page and
<http://localhost:8000/dashboard> for the history view.

## With a receiver

```bash
just probe                    # find your decoder's aircraft.json
$EDITOR config.toml           # mode = "local", local_host = ...
just serve
```

Set your home position on the settings page. Then follow
[docs/HARDWARE.md](docs/HARDWARE.md) to build the panel.

## Layout

```
skypanel/
├── backend/          Python 3.12, FastAPI. Sources, enrichment, frame contract
│   ├── skypanel/
│   ├── data/         airlines.json, airports.csv, recorded fixtures
│   └── tests/        pytest, cassette-backed, offline
├── firmware/         PlatformIO, C++17
│   ├── src/          device main(): WiFi, buttons, OTA
│   ├── lib/render/   SHARED — Renderer, fonts, scroller, JSON, frame parser
│   ├── lib/display/  IDisplay, Hub75Display, EmulatorDisplay, PanelSim
│   ├── lib/net/      IHttpClient, ESP32 and socket implementations
│   ├── lib/app/      PanelApp: poll, render, buttons. Shared with the emulator
│   └── test/         native test binary, including golden images
├── emulator/         SDL2 host, PNG/GIF writers, browser view, fixtures
├── deploy/           systemd unit, Dockerfile, docker-compose
├── docs/
└── tools/            font generator, fixture capture, data reduction
```

## Documentation

| | |
|---|---|
| [docs/HARDWARE.md](docs/HARDWARE.md) | Bill of materials, wiring, power, assembly |
| [docs/EMULATOR.md](docs/EMULATOR.md) | Running it, what the simulation models, golden tests |
| [docs/BACKEND.md](docs/BACKEND.md) | API reference, data sources, enrichment |
| [docs/FONTS.md](docs/FONTS.md) | Why these faces, and how to edit them |

## Common tasks

```bash
just                     # list everything
just test                # render tests + backend tests + lint
just scenario            # replay a busy Dublin approach at 4x
just record out.gif 12   # record the scrolling behaviour
just approve-snapshots   # accept new golden images, then read the diff
just add-airline EIN "Aer Lingus" "#008D7F" EI
just capture-fixtures raspberrypi.local
just firmware && just flash
```

## Deployment

```bash
sudo cp deploy/skypanel.service /etc/systemd/system/
sudo systemctl enable --now skypanel
```

or `cd deploy && docker compose up -d`. Both are documented inline.

## Attribution and licensing

* Aircraft data from your own receiver, or from **adsb.fi** / **adsb.lol** /
  **airplanes.live** — attribution is shown in the settings UI and on the
  dashboard when an aggregator is in use, as their terms require.
* Route and aircraft-type enrichment from **adsbdb.com**, optionally
  **FlightAware AeroAPI**.
* Airport data from **OurAirports** (public domain).
* `Adafruit_GFX` and `TomThumb` are vendored under their BSD licences; see
  `firmware/lib/vendor/Adafruit_GFX/license.txt`.

No secrets live in this repository. Copy `.env.example` to `.env` if you want
AeroAPI.
