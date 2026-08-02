# Operations

Running SkyPanel on a Pi, and what to do when it stops working.

## Install

### systemd (recommended on a Pi that already runs dump1090)

```bash
sudo useradd --system --home /var/lib/skypanel --create-home skypanel
sudo mkdir -p /opt/skypanel /etc/skypanel
sudo rsync -a --exclude .venv backend/ /opt/skypanel/
sudo cp backend/config.toml /etc/skypanel/config.toml
sudo cp deploy/skypanel.service /etc/systemd/system/

# Dependencies, installed as the service user.
sudo -u skypanel sh -c 'cd /opt/skypanel && uv sync --frozen'

sudo systemctl daemon-reload
sudo systemctl enable --now skypanel
systemctl status skypanel
```

Edit `/etc/skypanel/config.toml` to point at your receiver, then
`sudo systemctl restart skypanel`. Secrets go in `/etc/skypanel/skypanel.env`, which the
unit reads and which should be `chmod 600`.

### Docker

```bash
cp .env.example .env      # fill in AEROAPI_KEY if you have one
docker compose -f deploy/docker-compose.yml up -d
```

The compose file uses host networking, because the backend needs to reach
`raspberrypi.local` and the panel needs to reach the backend, and bridge networking makes
both awkward for no gain on a single-host deployment.

## Configuration

Two layers, deliberately separate:

| | Where | Changed by |
|---|---|---|
| **Deployment** — which feed, which host, API keys, paths | `config.toml` + environment | editing a file, restart |
| **User settings** — units, lines, filters, radius, brightness | `var/settings.json` | the web UI or `POST /api/settings`, live |

Secrets only ever come from the environment. `config.toml` is checked in.

Point it at your receiver:

```toml
[source]
mode = "local"
local_host = "raspberrypi.local"
failover = true          # → aggregator if local is unhealthy for 60 s
```

Or run with no receiver at all:

```toml
[source]
mode = "aggregator"
aggregator_provider = "adsb_fi"   # adsb_fi | adsb_lol | airplanes_live
```

Check each provider's current terms before enabling it. adsb.fi is non-commercial and
requires attribution; adsb.lol is ODbL. The backend surfaces the required credit in
`/api/frame` (`note`) and in the settings page — don't remove it.

Or with neither, for development:

```toml
[source]
mode = "mock"
```

## Day-to-day

```bash
# Is it healthy?
curl -s localhost:8000/healthz | python3 -m json.tool

# What is the panel showing right now?
curl -s localhost:8000/api/frame | python3 -m json.tool

# What is it looking at?
curl -s localhost:8000/api/nearest | python3 -m json.tool

# Follow a specific flight
curl -sX POST localhost:8000/api/track -H 'Content-Type: application/json' \
     -d '{"ident":"BA249"}'
curl -sX POST localhost:8000/api/track/cancel

# Change a setting
curl -sX POST localhost:8000/api/settings -H 'Content-Type: application/json' \
     -d '{"distance_unit":"km","speed_unit":"kmh"}'
```

The web UI at `http://<host>:8000/` does all of this and is built for a phone. The
history dashboard is at `/history`.

## Troubleshooting

### The panel says `NO WIFI`

The stored credentials are wrong or the network is down. Hold both front buttons for
three seconds — or at boot — to re-enter the setup portal. Join `SkyPanel-XXXX` and open
`http://192.168.4.1`.

### The panel says `NO BACKEND`

The device reached WiFi but not the backend. Check:

```bash
curl -s http://<backend-host>:8000/api/frame
```

from another machine on the same network. If that works, the address stored on the device
is wrong — re-run setup. Note that `.local` names need mDNS, which some networks block;
an IP address always works.

### The panel says `NO DATA`

The backend is up but its feed is not. `/healthz` says which and why:

```json
{"active_source": "none",
 "last_error": "no aircraft.json found on raspberrypi.local — checked the dump1090, ..."}
```

The most common cause is a decoder without a web interface. Verify by hand:

```bash
curl -s http://raspberrypi.local:8080/data/aircraft.json | head -c 200
```

If your decoder serves it somewhere unusual, set `[source].local_path` explicitly;
`{host}` is substituted.

### The panel shows garbage

An FM6126A driver chip. Tick the box in the setup portal. See
[HARDWARE.md](HARDWARE.md#fm6126a-panels).

### The panel says `BROWNOUT`

The last reset was a supply brownout, and the panel has come back at brightness 24 to
avoid a reboot loop. This is a power problem, not a software one —
[HARDWARE.md](HARDWARE.md#power).

### Routes are missing

`origin`/`destination` come from the enrichment layer, not from ADS-B. Check
`/healthz` for cache statistics and, if you have configured AeroAPI, the quota:

```json
{"aeroapi": {"enabled": true, "used_this_month": 41, "monthly_limit": 400, "remaining": 359}}
```

Once the ceiling is reached the client stops firing and everything degrades to adsbdb.
Raise `[enrich].aeroapi_monthly_limit` only if you understand what it will cost.

Military and government callsigns usually have no route at all. Those lookups are
negatively cached for an hour so they are not re-queried on every poll.

### An airline shows in white

It isn't in `data/airlines.json`. Add it:

```bash
just add-airline BAW "British Airways" '#075aaa'
```

The file is data. Adding to it needs no code change and no redeploy — the backend
re-reads it when the entry is written.

## Firmware updates

The device checks for updates against a manifest served by the backend, so an update
never leaves the LAN.

```toml
[server]
firmware_manifest = "var/firmware/manifest.json"
```

```json
{
  "type": "skypanel-s3",
  "version": "0.2.0",
  "url": "http://raspberrypi.local:8000/firmware/skypanel-0.2.0.bin"
}
```

Build with `pio run -e esp32s3`, copy `.pio/build/esp32s3/firmware.bin` next to the
manifest, and bump the version. The device checks every six hours and shows
`UPDATING / DO NOT UNPLUG` while it flashes.

For the first flash, USB:

```bash
cd firmware
pio run -e esp32s3 -t upload
pio device monitor
```

## Backups

Everything worth keeping is in `state_dir` (default `backend/var/`):

| File | Contents | Losing it means |
|---|---|---|
| `settings.json` | User settings | Back to defaults |
| `cache.sqlite3` | Route/aircraft cache, AeroAPI counter | A burst of re-lookups; **and a reset month counter**, so back this one up if you use AeroAPI |
| `history.sqlite3` | Sightings for the dashboard | The dashboard starts empty |

None of it is precious. `sqlite3 .backup` or a file copy while stopped is enough.
