# Hardware

Bill of materials, wiring and the failure modes worth knowing before you order
anything.

## Bill of materials

| Part | Spec | Approx. cost | Notes |
|---|---|---|---|
| Adafruit MatrixPortal S3 | ESP32-S3, 8 MB flash, 2 MB PSRAM, HUB75 socket, USB-C | £25 | Plugs straight onto the panel; no wiring at all |
| RGB LED matrix | 64×32, P4, 1/16 scan, HUB75 | £18 | P3 also works; see *Pitch* below |
| USB-C power supply | 5 V, 3 A minimum | £10 | **Not** a phone charger you had lying around; see *Power* |
| Diffuser (optional) | 3 mm acrylic, light-diffusing white | £6 | Turns visible dots into a much nicer glow |
| Frame (optional) | Laser-cut ply or a 3D print | — | The panel has M3 mounting holes on the back |

Total: roughly £55–65, plus whatever you already run the receiver on.

The backend needs a Linux box on the same network. A Raspberry Pi already
running `dump1090-fa` or `readsb` is the obvious host and adds no cost.

### Receiver side (if you do not already have one)

| Part | Spec | Approx. cost |
|---|---|---|
| RTL-SDR dongle | R820T2 or RTL-SDR Blog V3/V4, 1090 MHz | £25 |
| 1090 MHz antenna | Quarter-wave or a commercial ADS-B antenna | £15–40 |
| Raspberry Pi | Zero 2 W upwards | £18+ |

A local receiver is worth the effort: 1 Hz updates, no rate limits, no terms of
service, and sub-second latency. The aggregator fallback exists for the days it
is down, not as the intended setup.

## Panel choice

**Pitch.** P4 (4 mm between LEDs) makes a 64×32 panel 256×128 mm — a good desk
size. P3 is 192×96 mm, brighter per unit area and slightly easier to read at a
distance because the dots are proportionally larger relative to their gaps. The
emulator's `--pitch p3|p4` shows the difference before you buy:

```bash
just build
./build/skypanel-emu --frame emulator/fixtures/ryanair.json --pitch p3 --scale 12
./build/skypanel-emu --frame emulator/fixtures/ryanair.json --pitch p4 --scale 12
```

**Scan rate.** A 32-row panel is normally 1/16 scan and uses address lines A–D
only. If you buy a 64×64 panel instead you need the E line as well, and the
pin map below changes.

**Driver chip.** Some panels use an FM6126A driver, which needs a register init
sequence before it will show anything. Symptoms are a dark panel, or garbage
that does not respond to what you draw. There is no way to detect this at
runtime, so it is a setting: tick **FM6126A** in the setup portal, or set
`fm6126a = true` in the device config. If a new panel looks broken, try this
first — it is the single most common cause.

## Wiring

The MatrixPortal S3 plugs directly into the panel's HUB75 input. There is
nothing to solder and nothing to get wrong, which is most of why it is the
recommended board.

For reference, the pin map the firmware uses (`lib/display/Hub75Display.cpp`):

| Signal | GPIO | | Signal | GPIO |
|---|---|---|---|---|
| R1 | 42 | | A | 45 |
| G1 | 41 | | B | 36 |
| B1 | 40 | | C | 48 |
| R2 | 38 | | D | 35 |
| G2 | 39 | | E | — (unused at 1/16 scan) |
| B2 | 37 | | LAT | 2 |
| CLK | 14 | | OE | 47 |

Buttons, as used by `lib/app/Buttons.cpp`:

| Button | GPIO | Function |
|---|---|---|
| Top | 6 | Short: cancel tracking / cycle info lines. Long: poll now |
| Front up | 7 | Hold with *front down* for 3 s: re-enter WiFi setup |
| Front down | 8 | " |

All three are active-low with internal pull-ups.

**Power.** Feed the panel from its own screw terminals, not through the
MatrixPortal, and use the supplied power cable. USB-C alone is enough for the
board but not for a bright panel.

## Power, and the reboot loop that is not a software bug

A 64×32 P4 panel showing text draws well under 1 A. The same panel showing a
full white frame can pull 3–4 A. If the supply sags, the ESP32 browns out and
resets — which looks exactly like a crash loop and sends people hunting through
their code for hours.

Three mitigations, all already in place:

1. `Hub75Display::kMaxBrightness` caps brightness at 200/255, keeping the worst
   case inside what a 5 V/3 A supply can hold up.
2. Brownout detection stays enabled (`CONFIG_ESP32_BROWNOUT_DET=1`). Disabling
   it is a popular "fix" and it only converts a clean reset into corrupted
   flash.
3. On boot the firmware checks `esp_reset_reason()`. A brownout reset drops
   brightness to 80 and shows `POWER SAG` on the panel, so the cause is visible
   without a serial cable.

If you see `POWER SAG`, get a better supply before doing anything else.

## Assembly

1. Set the panel face down on something soft.
2. Plug the MatrixPortal into the HUB75 input; the connector is keyed.
3. Connect the panel's power leads to the MatrixPortal's screw terminals,
   watching polarity — red to `+`, black to `-`.
4. Plug in USB-C. The panel shows `SkyPanel-XXXX`.
5. Join that WiFi network from a phone. The setup page opens automatically; if
   not, browse to `192.168.4.1`.
6. Enter your WiFi credentials and the backend URL
   (`http://raspberrypi.local:8000`), then save. The device restarts and starts
   showing aircraft.

To re-enter setup later, hold both front buttons for three seconds.

## Enclosure notes

* A 3 mm light-diffusing acrylic sheet 5–10 mm in front of the panel softens
  the dots considerably. Clear acrylic does not; it just adds reflections.
* Leave the back open or vented. A panel at full brightness in a sealed box
  gets warm enough to shorten LED life.
* The panel has M3 threaded holes on the back at 60 mm spacing.
* Mount it slightly above eye level and tilted down a few degrees. HUB75
  panels have noticeably better contrast viewed straight on.

## Known-good combinations

| Panel | Result |
|---|---|
| Adafruit 64×32 P4 (#2278) | Works out of the box, `fm6126a = false` |
| Waveshare 64×32 P3 | Works, `fm6126a = false` |
| Generic AliExpress 64×32 P4 | Usually needs `fm6126a = true` |

Add yours here if you try something else.
