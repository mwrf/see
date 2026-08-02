# The emulator

The emulator is the primary development target. It is not a mock: it compiles
the firmware's own renderer, fonts, scroller and poll loop natively and blits
the resulting `GFXcanvas16` to a simulated panel instead of a HUB75 one.

```
                       lib/render + lib/app          (identical sources)
                                 |
              +------------------+------------------+
              |                                     |
      Hub75Display                          EmulatorDisplay
      (ESP32-HUB75-I2S-DMA)                  (PanelSim -> SDL / PNG / GIF)
```

If it looks right in the emulator it is right on the panel. That claim only
holds because of the three things in `PanelSim`, described below.

## Building

```bash
just build          # or: cmake -B build && cmake --build build -j
```

Dependencies are a C++17 compiler and zlib. **SDL2 is optional**: without it
the window will not open, but `--snapshot`, `--record` and the whole test suite
still work, which is what lets CI run with no display libraries at all.

## Usage

```bash
# Live, against a running backend
just emu --backend http://localhost:8000

# One static frame, forever
./build/skypanel-emu --frame emulator/fixtures/ryanair.json

# A scenario: one JSON document per line, one per poll
./build/skypanel-emu --scenario emulator/fixtures/busy.jsonl --speed 4

# Headless, for tests and bug reports
./build/skypanel-emu --snapshot out.png --frame emulator/fixtures/ryanair.json

# Record an animation
./build/skypanel-emu --record out.gif --duration 30 --scenario emulator/fixtures/busy.jsonl
```

`--frame` and `--scenario` work by swapping in a `FileHttpClient` rather than
by special-casing anything in `PanelApp`. The poll interval, the JSON parse and
the error handling are all the real ones, so a malformed frame fails the same
way in the emulator as on the device.

### Panel simulation options

| Flag | Default | What it does |
|---|---|---|
| `--scale N` | 10 | Screen pixels per LED |
| `--pitch p3\|p4` | p4 | Dot size relative to the gap |
| `--brightness 0-255` | 255 | Dims exactly the way the driver does |
| `--gamma G` | 2.2 | The driver's ramp; changing it is for experiments only |
| `--bloom` | off | LED glow. Off by default so snapshots stay exact |
| `--no-dots` | — | Flat pixels instead of round LEDs |

### Timing

| Flag | Default | What it does |
|---|---|---|
| `--speed N` | 1 | Runs the virtual clock N× faster |
| `--fps N` | 30 | Redraw rate |
| `--poll MS` | 5000 | Backend poll interval |
| `--at MS` | 0 | Virtual time to capture a snapshot at |
| `--duration S` | 10 | Seconds to record |

`--at` is how the golden tests pin scrolling: the app is ticked in frame-sized
steps to an exact virtual time, so a marquee mid-cycle is reproducible.

### Keys

| Key | Maps to |
|---|---|
| space | Top button, short press |
| return | Top button, long press |
| `s` | Both front buttons held (setup) |
| `[` / `]` | Brightness down / up |
| `p` | Toggle P3 / P4 |
| `b` | Toggle bloom |
| `q`, Esc | Quit |

### Browser view

```bash
./build/skypanel-emu --backend http://localhost:8000 --web 8080
# then open http://localhost:8080/
```

The same port serves the viewer page and the WebSocket. Frames arrive as
`[uint16 width][uint16 height][RGB bytes]`. Useful for a second monitor, a
phone, or watching the panel over SSH where SDL cannot open a window.

## Why the simulation looks the way it does

**Gamma, applied first and always.** The HUB75 driver puts a 2.2 gamma ramp
between the value you write and the light that comes out. A simulator that
blits linear values makes mid-tones look far brighter than they will be. This
is not a subtlety — it is the single biggest cause of "looked fine in the sim,
unreadable on the panel", and it changed the design of this project: Ryanair's
`#073590` emits 73/255 on a real panel and several carriers' navies emit under
30. `colours.ensure_legible` in the backend exists because the emulator made
that visible. See `backend/skypanel/colours.py`.

**Dots with gaps.** Real pixels are discrete emitters. Drawing each one as a
rounded dot with the correct gap is what lets you judge whether a 3 px font is
genuinely legible, rather than legible-as-a-smooth-bitmap.

**Bloom, off by default.** LEDs bleed into their neighbours, which matters when
choosing adjacent colours — and which makes image diffs unreadable. So it is a
toggle, and snapshot tests never use it.

## Golden-image tests

```bash
just test-render        # runs everything, including 13 golden images
just approve-snapshots  # accept the current rendering, then read the diff
```

Each fixture is rendered through the whole device path and compared
pixel-for-pixel against `emulator/snapshots/`. Any difference fails: at 64×32,
a one-pixel change is a legibility change.

Comparison decodes both PNGs rather than diffing the files, so a zlib version
bump cannot break the suite. On failure the test writes
`<name>.actual.png` next to the golden so the change can be looked at rather
than guessed at.

The goldens cover the things that break quietly: font metrics, line layout,
scroll offsets at a fixed virtual time, brand colours, the progress bar, and
the live/stale/offline corner indicator.

## Adding a fixture

Frame fixtures are `DisplayFrame` documents — the same JSON the backend serves
at `/api/frame`:

```bash
curl -s localhost:8000/api/frame | python3 -m json.tool > emulator/fixtures/mine.json
./build/skypanel-emu --frame emulator/fixtures/mine.json --scale 12
```

To include it in the golden suite, add an entry to `kSnapshots` in
`firmware/test/test_snapshots.cpp` and run `just approve-snapshots`.
