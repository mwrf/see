# Hardware

Bill of materials, wiring and the things that go wrong. Kept current as the build
progresses — if something here disagrees with the code, the code is right and this is a
bug.

## Bill of materials

### The panel

| Item | Notes | Approx. |
|---|---|---|
| Adafruit MatrixPortal S3 (#5778) | ESP32-S3, 8 MB flash + 2 MB PSRAM, HUB75 connector on the back, USB-C, three buttons. The connector is why this board and not a bare dev kit. | £25 |
| 64×32 RGB LED matrix, P4, 1/16 scan | 256 × 128 mm. P3 (192 × 96 mm) also works and is sharper per unit area; P4 is easier to read across a room. | £20–30 |
| 5 V 4 A PSU, 2.1 mm barrel | See "Power" below — 2 A is not enough headroom. | £10 |
| Barrel jack to screw terminal | The MatrixPortal takes power on its terminal block. | £2 |
| USB-C cable | Flashing and serial. | — |

Optional but recommended:

| Item | Notes |
|---|---|
| Panel frame or 3D-printed bezel | The bare module has exposed magnets and a cable stub. |
| Diffuser (2 mm acrylic, light-diffusing white) | Softens the dot grid. Costs ~20% brightness. |
| M3 standoffs ×4 | The panel has M3 threaded holes on the back. |

### The receiver (optional, but the whole point)

| Item | Notes | Approx. |
|---|---|---|
| Raspberry Pi 4 / 5 / Zero 2 W | Runs the backend and the decoder. A Zero 2 W is enough. | £15–60 |
| RTL-SDR dongle (R820T2 / RTL2832U) | The blue "RTL-SDR Blog V3" is the usual choice. | £30 |
| 1090 MHz antenna | A quarter-wave whip made from coax works; a proper collinear does much better. | £0–25 |
| SMA pigtail / adapter | Matches the dongle to the antenna. | £5 |

Without a receiver, run the backend against a public aggregator — see
[OPERATIONS.md](OPERATIONS.md). The display is identical; only the coverage differs.

## Wiring

There is almost none, which is the reason for choosing the MatrixPortal.

```
                  ┌──────────────────────────┐
   5 V 4 A  ──────┤ + screw terminal         │
   PSU      ──────┤ –                        │   MatrixPortal S3
                  │                          │
                  │  HUB75 header (16-pin) ──┼───► panel IN (short ribbon, supplied)
                  └──────────────────────────┘
                                                  panel power ──► same 5 V PSU
```

1. Plug the MatrixPortal's HUB75 header into the panel's **IN** connector. The panel has
   an IN and an OUT; the OUT is for chaining and will show nothing.
2. Connect the panel's power pigtail to the PSU. **Do not** power the panel from the
   MatrixPortal's terminal block — the board's traces are not rated for the panel's
   current.
3. Connect the MatrixPortal's terminal block to the same PSU, observing polarity.
4. USB-C for flashing. It is fine to have USB and the PSU connected at once.

If you are hand-wiring to a different ESP32 board instead, the pin map the firmware
expects is in `firmware/lib/display/Hub75Display.h` (`Hub75Pins`), which is the
MatrixPortal S3's fixed assignment.

### Buttons

The MatrixPortal S3 has three buttons, all active-low with internal pull-ups:

| Button | GPIO | Function |
|---|---|---|
| Top | 6 | Tap: rotate the info lines. Hold ~1.2 s: cancel tracking. |
| Front left | 7 | With front right, hold 3 s: re-enter WiFi setup. |
| Front right | 8 | " |

Holding both front buttons **at boot** also forces setup mode, which is the escape hatch
when the stored WiFi credentials are wrong.

## Power

This is the part that bites.

A 64×32 P4 panel is 2048 RGB LEDs. Datasheets quote worst case at full white, full
brightness: roughly **3.5–4 A at 5 V**. SkyPanel draws far less — text on black at the
default brightness of 60/255 measures well under **1 A** — but the peak is what the
supply has to survive, and cheap 2 A supplies sag on the inrush at power-on.

Buy 4 A. It costs a pound more than 2 A.

Three defences are built in:

- **A brightness ceiling.** `Hub75Config::maxBrightness` (default 160/255) is enforced in
  software, so no setting or frame can command full output.
- **Brownout detection.** `esp_reset_reason()` is checked at boot. A brownout reset puts
  the panel into safe mode at brightness 24 and shows `BROWNOUT / CHECK 5V SUPPLY`,
  because the symptom otherwise looks exactly like a software crash loop.
- **Night mode.** Dims both the driver *and* the colours between the configured hours.

Symptoms of an inadequate supply, in the order you will meet them:

| Symptom | Cause |
|---|---|
| Panel flickers on bright frames | Volt drop under load. Thicker power leads, or a better PSU. |
| Board reboots when the panel lights up | Inrush. Almost always the PSU. |
| Colours tint towards red at the far end of the panel | Volt drop along the panel's own bus. Feed power to both ends. |
| `BROWNOUT` on the panel at boot | The last reset was a brownout; safe mode is active. |

## FM6126A panels

Some 64×32 modules use an FM6126A driver chip instead of the more common shift
registers. They need a register initialisation sequence before they will display
anything but noise, and there is no way to detect this from software.

If your panel shows garbage — a static field of coloured dots, or the image smeared
horizontally — tick **"Panel shows garbage (FM6126A driver chip)"** in the setup portal.
That sets `fm6126a`, which the firmware passes to the HUB75 driver as
`HUB75_I2S_CFG::FM6126A`.

## Assembly notes

- The panel's magnets will happily attach it to a radiator or a fridge. They will also
  happily attach it to your screwdriver mid-assembly.
- The supplied HUB75 ribbon is short. That is deliberate — it is a fast parallel bus and
  a long ribbon picks up noise that shows as sparkle.
- Mount the MatrixPortal on standoffs rather than letting it hang on the ribbon.
- Leave the USB-C port accessible. Serial output is the fastest way to find out why the
  panel is showing `NO WIFI`.

## Receiver setup

Any dump1090 fork works. On a Pi:

```bash
sudo apt install dump1090-fa          # or: readsb, dump1090-mutability
```

Confirm it is serving data before pointing SkyPanel at it:

```bash
curl -s http://raspberrypi.local:8080/data/aircraft.json | head -c 200
```

The backend probes these paths in order and remembers the one that answers:

```
http://{host}:8080/data/aircraft.json           dump1090, dump1090-mutability
http://{host}:8080/skyaware/data/aircraft.json  dump1090-fa
http://{host}:8080/tar1090/data/aircraft.json   readsb, tar1090
http://{host}/tar1090/data/aircraft.json
```

If none answer, the backend says so with the list of paths it tried rather than raising
a stack trace. The usual causes are a decoder built without its web interface, or
lighttpd not running.

Antenna placement matters more than anything else in the BOM. A £5 whip in a window
outperforms a £50 antenna in a cupboard.
