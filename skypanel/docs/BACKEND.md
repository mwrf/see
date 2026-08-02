# Backend

Python 3.12, FastAPI, one process. It polls ADS-B, enriches it, and emits the
semantic frame the panel renders.

## Why the device is thin

The ESP32 does display, buttons and WiFi. Everything else happens here, because
a Pi can hold an airline database, a route cache and a unit-conversion table
and an ESP32 cannot — and because changing a unit or a colour should not mean
reflashing a device screwed to a wall.

The consequence is that `/api/frame` carries no policy for the device to apply:
units are formatted, colours are resolved, fields are selected, and the
renderer only turns strings into pixels.

## Running

```bash
just setup                 # uv venv + dependencies
cp config.example.toml config.toml
just probe                 # find your receiver's aircraft.json
just serve                 # http://localhost:8000
```

`python -m skypanel` also takes `frame` (print one frame and exit) and `probe`
(report which candidate URL answered), both useful when nothing is working.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/frame` | **What the device polls.** A `DisplayFrame` |
| GET | `/api/nearest` | Full enriched record for the current target |
| GET | `/api/aircraft` | Everything in range, nearest first |
| GET | `/api/settings` | Current settings plus UI metadata |
| POST | `/api/settings` | Update settings (JSON or form-encoded) |
| POST | `/api/track` | `{"ident": "BA249"}` — enter tracking mode |
| POST | `/api/track/cancel` | Return to nearest-aircraft mode |
| GET | `/api/history?hours=24` | Sightings and a summary |
| GET | `/api/airlines` | The colour table, for the settings UI |
| GET | `/healthz` | Source health, cache stats, AeroAPI quota |
| GET | `/api/firmware/manifest.json` | esp32FOTA manifest |
| GET | `/firmware/{name}` | A published firmware image |
| GET | `/` | Settings page |
| GET | `/dashboard` | History dashboard |

### `GET /api/frame`

```json
{
  "mode": "nearest",
  "source": "local",
  "generated_at": "2026-08-02T09:14:03Z",
  "lines": [
    {"text": "RYANAIR", "colour": "#0840AE", "style": "title", "scroll": "auto"},
    {"text": "FR1812  DUB→STN  B738", "colour": "#c8c8c8", "style": "body", "scroll": "auto"},
    {"text": "24,000FT  410KT  6.1MI", "colour": "#808080", "style": "body", "scroll": "auto"}
  ],
  "progress": null,
  "status": "live"
}
```

* `mode` — `nearest` | `tracking` | `empty` | `error`
* `status` — `live` | `stale` | `offline`, drives the corner indicator
* `scroll` — `none` | `auto`; *auto* means scroll **only if** the string
  overflows 64 px, which the renderer decides from its own metrics
* `progress` — `{"fraction": 0.62, "eta": "13:14"}` in tracking mode, else null

This endpoint never returns 5xx. A dead receiver produces an `error` frame,
because a device that gets a 500 has nothing to show and no way to say why.

Note the title colour: `#0840AE`, not the raw brand `#073590`. Dark brand
colours are lifted so they survive the panel's gamma ramp — see
`colours.ensure_legible` and [EMULATOR.md](EMULATOR.md).

## Data sources

Three implementations of one protocol; the choice is config, not code.

```toml
[source]
mode = "auto"                    # local | aggregator | mock | auto
local_host = "raspberrypi.local"
aggregator_provider = "adsb_fi"  # adsb_fi | adsb_lol | airplanes_live
failover = true
failover_after_s = 60.0
```

**local** — your own decoder, and the one to use. On first run it probes four
candidate paths in order (`/data/aircraft.json`, `/skyaware/data/...`,
`/tar1090/data/...`, and the port-80 tar1090 path) and remembers the winner. It
handles the wire format's quirks: space-padded `flight`, `alt_baro` as the
literal string `"ground"`, `t`/`r` present only when the decoder has an
aircraft database loaded, and positions older than 30 s. A total probe failure
produces a diagnostic with a hint, not a stack trace, because the cause is
almost always a wrong path or a decoder with no web interface.

**aggregator** — adsb.fi, adsb.lol or airplanes.live. All three speak the
ADSBExchange v2 shape, so one client covers them with a configurable base URL.
A 1 req/s token bucket, an identifying `User-Agent`, exponential backoff on
429, and a last-good cache so a throttled poll never blanks the display.
Attribution is surfaced in the UI where the provider's terms require it.

**mock** — replays `data/fixtures/*.json` on a loop. Every test uses it.

**auto** probes local at startup and falls back to the aggregator permanently
unless local later recovers; a slow timer rechecks so a rebooted receiver is
picked up without restarting the service. Whichever source served the current
frame is always reported, in the API and in the settings UI.

## Enrichment

ADS-B carries no origin or destination, so:

1. **Cache first** (SQLite, warmed at startup). Routes 12 h, aircraft types
   30 d, and — the one that matters — *negative* lookups 1 h, so an unmatched
   military callsign costs one query an hour rather than one per poll.
2. **adsbdb.com**, free and keyless, is the default provider.
3. **FlightAware AeroAPI**, only when `AEROAPI_KEY` is set and only to improve
   a result (a missing route, or an ETA adsbdb does not have). Feeders get
   $10/month of query fees free, so the client refuses to spend past a
   configurable monthly ceiling and degrades back to adsbdb when it hits it.
   `/healthz` reports the counter.

Airport codes become city names from an OurAirports subset
(`data/airports.csv`, public domain). Airline names and brand colours come from
`data/airlines.json` — data, not code, so `just add-airline` is enough to grow
it. Unknown airlines render white, deliberately: a wrong brand colour reads as
a bug, white reads as "we don't know this one".

## Settings

Two things, deliberately separate:

* `config.toml` — deployment config (source, receiver host, provider, cache
  paths). Changing it needs a restart.
* Persisted user settings — units, route display, which lines to show,
  category filters, scan radius, night mode, brightness, poll interval, home
  position. Edited from the phone-friendly page at `/`, stored as JSON, live on
  the device's next poll.

Unknown keys in a settings POST are rejected rather than ignored, because a
typo that silently does nothing looks like a backend bug.

## Testing

```bash
just test-backend
just lint          # ruff + ruff format --check + mypy --strict
```

280 tests, none of which touch the network. Every outbound call goes through
one `HttpClient` with a timeout and a retry policy, and the tests inject
recorded cassettes into it (`tests/cassettes/`). The clock is injectable
everywhere it matters, so rate limiting, backoff, TTL expiry and failover
timing are tested without sleeping.
