# Architecture

Four ideas hold this project up. Everything else follows from them.

## 1. The emulator is not a mock

`firmware/lib/render/` draws into an `Adafruit_GFX` `GFXcanvas16`. That canvas is then
handed to an `IDisplay`, which is either a HUB75 panel over I2S DMA or an SDL2 window.

```
        DisplayFrame (JSON)
               │
      ┌────────▼────────┐
      │ FrameParser     │   fixed-capacity structs, no allocation
      └────────┬────────┘
      ┌────────▼────────┐
      │ Renderer        │   layout, colours, Scroller, Text, fonts
      │   → GFXcanvas16 │   ← shared, compiled for both targets
      └────────┬────────┘
               │
        ┌──────┴──────┐
        │             │
┌───────▼──────┐ ┌────▼──────────────┐
│ Hub75Display │ │ EmulatorDisplay   │
│ (ESP32 only) │ │ + PanelPainter    │
└──────────────┘ └───────────────────┘
                        │
              ┌─────────┼─────────┐
          SDL2 window  PNG       GIF
```

PlatformIO builds the left branch; CMake builds the right one. They compile the same
source files — there is no second renderer to keep in sync, and no way for the two to
drift.

`PanelPainter` is what makes the right branch honest: LED dots with a real fill factor
and gap, P3/P4 pitch, the HUB75 driver's gamma ramp, and its brightness curve. The SDL
window, the golden PNGs and the GIF recorder all go through it, so all three agree.

## 2. Two interchangeable data feeds

```python
class AircraftSource(Protocol):
    async def fetch(self, lat: float, lon: float, radius_nm: float) -> list[Aircraft]: ...
    @property
    def healthy(self) -> bool: ...
```

- `local` — dump1090/readsb `aircraft.json` on the LAN. Probes four known paths and
  remembers the one that answers.
- `aggregator` — adsb.fi / adsb.lol / airplanes.live. One client; they all speak the
  ADSBExchange v2 shape. Token bucket at 1 req/s, exponential backoff on 429, and a
  last-good response so a failed poll never blanks the panel.
- `mock` — replays recorded `aircraft.json` snapshots. Every test uses it.

`SourceManager` picks between them and fails over. Which feed served the current frame is
always reported, in `/api/frame`, in `/healthz` and in the settings UI — partly because
the aggregators' licences require attribution, and partly because "why is it wrong"
always starts with "which feed was that".

The wire-format quirks live in `sources/base.py` rather than in each source, because they
are shared: space-padded `flight`, `alt_baro` as the string `"ground"`, `t`/`r` present
only when the decoder has an aircraft database loaded.

## 3. Thin firmware, smart backend

The ESP32 does display, buttons and WiFi. It makes one plain-HTTP GET every few seconds
and renders what comes back:

```json
{
  "mode": "nearest",
  "source": "local",
  "lines": [
    {"text": "RYANAIR", "colour": "#073590", "style": "title", "scroll": "auto"},
    {"text": "FR1812  DUB→STN  B738", "colour": "#c8c8c8", "style": "body"},
    {"text": "24,000FT  410KT  6.1MI", "colour": "#808080", "style": "body"}
  ],
  "progress": null,
  "status": "live"
}
```

The frame is *semantic*, not pixels. Units, colours, route formatting, field selection
and night dimming are all applied server-side from user settings, so changing any of them
is a `POST /api/settings` away and needs no reflash.

Two fields ride along beyond the spec's contract — `brightness` and `poll_interval_s` —
so the device needs exactly one request per cycle rather than one for the frame and one
for the settings that might have changed under it.

The backend's whole cycle is one function:

```
PanelService.poll_once()
    sources.fetch()  →  geo.annotate/nearest  →  enricher.enrich()  →  frame.build_*()
```

It is directly callable, which is how the tests drive it. The background loop exists only
to call it on a timer so the device's poll is always answered from memory.

## 4. Everything testable on a laptop

| Suite | What it covers | How to run |
|---|---|---|
| 168 pytest cases | Sources, parsing quirks, enrichment, cache TTLs and quotas, geo, units, settings, tracking, the HTTP API | `just test-backend` |
| 108 native C++ cases | Fonts, text layout, JSON, frame parsing, scrolling, renderer layout, the panel painter, buttons, device config | `just test-native` |
| 19 golden images | Fonts, layout, scrolling, colour, gamma, pitch — rendered headless through the real binary and compared pixel for pixel | `just test-snapshots` |

No test touches the network. Every external HTTP interaction is replayed from a cassette
in `backend/tests/cassettes/` **through the real client**, so the retry policy, the
timeout and the token bucket are all exercised — only the socket is replaced.

The golden images are generated from frames the real backend produced from the real
aircraft fixtures (`just export-frames`), so a change to units or colours shows up as a
snapshot diff rather than drifting silently.

## Enrichment

ADS-B carries no origin or destination, so it is layered on:

1. **adsbdb.com** — free, no key, the default. Callsign → airline and route, hex → type
   and registration.
2. **FlightAware AeroAPI v4** — optional, behind `AEROAPI_KEY`, and metered. Feeders get
   $10/month of query fees free, so it is only consulted when adsbdb came up short, every
   call is counted against a per-month ceiling stored in the cache, and the client
   *refuses to fire* once the ceiling is hit rather than running up a bill.
3. **SQLite cache** — routes 12 h, aircraft types 30 d, and negative results 1 h so an
   unmatched military callsign is not re-queried on every poll. Warmed at startup.
4. **Airports** — an OurAirports subset, `ident,iata,municipality` plus coordinates. The
   coordinates are there because tracking mode needs the endpoints of the leg.
5. **Airline colours** — `data/airlines.json`, ICAO code → name and `#RRGGBB`. Data, not
   code: `just add-airline` extends it. Unknown airlines render white.

Nothing in the enrichment layer raises on a provider failure. A missing route means the
panel shows one line less; it should never mean the panel shows an error.

## Repository layout

```
backend/            Python 3.12, FastAPI. Feeds, enrichment, frame building, settings UI.
  skypanel/sources/   local | aggregator | mock, and the manager that fails over
  skypanel/enrich/    adsbdb, AeroAPI, the SQLite cache, airports
  data/               airlines.json, airports.csv, recorded aircraft.json fixtures
  tests/cassettes/    every recorded HTTP interaction
firmware/
  lib/render/         SHARED — Renderer, Scroller, Text, Json, FrameParser, fonts
  lib/display/        IDisplay, Hub75Display, EmulatorDisplay, PanelPainter
  lib/device/         Buttons, DeviceConfig, Provisioning — pure logic where possible
  lib/net/            IHttpClient + ESP32 and POSIX implementations
  lib/compat/         Arduino shims so Adafruit_GFX builds for the desktop
  test/               native C++ tests, run by both CMake and PlatformIO
emulator/             SDL2 host, PNG/GIF writers, browser view, golden images
docs/  deploy/  tools/
```

## Deliberate omissions

- **No TLS on the device.** It talks to a machine on the same LAN. TLS on an ESP32 costs
  ~40 KB of heap and seconds of handshake per poll for no benefit here.
- **No general JSON library on the device.** The one document it parses is under a
  kilobyte; `lib/render/Json.cpp` is a few hundred lines with a fixed arena and no
  allocation, and it rejects rather than guesses.
- **No Arduino `String` in the render path.** Fixed-capacity buffers throughout.
- **No lowercase in the panel fonts.** At five pixels tall, `a`/`e`/`s` collapse into the
  same blob and descenders would cost a whole row.
