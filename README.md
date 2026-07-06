# EMX-Web — Korg Electribe MX (EMX-1) Emulator

A full-featured, web-based emulation of the Korg Electribe MX music production
station: sound engine, sequencer, effects, and front panel. Runs entirely in
the browser (desktop and mobile, landscape and portrait) with no assets to
download — the whole drum ROM and all wavetables are synthesized procedurally
at boot.

## Features

**Sound engine** (single AudioWorklet, sample-accurate, per the owner's manual)
- 5 monophonic synth parts with the hardware's 16 MMT oscillator algorithms —
  Wave Form, Dual Osc, Chord Osc, Unison, Ring Mod, Osc Sync, Cross Mod, VPM,
  Wave Shape, Additive, Comb Osc, Formant, Noise, PCM+Comb, PCM+WS, and
  Noiz+Comb (standing in for Audio In+Comb) — each with its WAVE selector and
  the manual's OSC EDIT1/EDIT2 semantics
- 9 drum parts (1–5, 6A/6B, 7A/7B with hardware exclusive pairs) from a
  207-wave procedural drum ROM; nonlinear ±2-octave pitch table
- Synth filter: LPF/HPF/BPF/BPF+ with resonance, bipolar EG INT, and DRIVE
- Amp EG (gate/decay), level, pan, roll (×2/×3/×4 roll types), per-part
  ACCENT SW and SWING SW, glide with true legato (overlapping gates don't
  retrigger), synth tune ±50 cents, master tune
- Modulation: Saw/Squ/Tri/S&H/Env (triangle free-runs; others reset per
  trigger), bipolar depth, BPM sync, hardware destination sets
  (drums: pitch/amp/pan; synths: + osc edit 1/2, cutoff)
- 3 effect processors × 16 types in manual order with manual EDIT semantics
  (BPM-synced note-value delays, grain shifter speed table, ±2400-cent pitch
  shifter, etc.) with chain routing
- Valve Force tube stage emulation (2× oversampled asymmetric waveshaper)

**Sequencer**
- 256 pattern slots (A.01–D.64), 1–8 bars, beat 16/32/8Tri/16Tri with
  hardware step grids (16/16/12/12 per measure), LAST STEP odd meters
- Swing 50–75 % on even steps, two accent parts (drum + synth)
- Motion sequences with SMOOTH / TRIG HOLD (switch params force TRIG HOLD)
- Realtime recording with held-gate capture, metronome (off/rec/on),
  erase-hold, reset, live transpose ±24, multi-part solo + mute
- Pattern ops: clear part/pattern, copy part, shift note, move data
- Song mode: 64 songs with per-position note offset and next-song chaining
- Arpeggiator: ribbon = gate/drum resolution, slider = pitch across the
  31 hardware scales with per-pattern center note
- Tempo 20–300 BPM with tap tempo

**Data**
- Autosave to IndexedDB (the browser is your SmartMedia card)
- Export/import all data or single patterns as JSON files

## Using it

Tap **POWER ON** (browsers require a gesture before audio starts), then:

- **Part select** — tap a part (S1–S5 synths, D1–D9 drums, ACC accent);
  long-press a part to mute it. Tapping a part auditions its sound.
- **Step keys** — tap to toggle steps for the selected part. Long-press a
  step (synth parts) to edit its note and gate. The mode buttons switch the
  16 keys between STEP / KEYBOARD (play live) / PART MUTE / PTN SET.
- **Knobs** — drag vertically. Double-tap to reset. Knobs follow the selected
  part, exactly like the hardware.
- **Record** — press ⏺ then ▶ and play the keyboard or hit part keys;
  hits are quantized into the pattern. Turn knobs while recording to capture
  motion sequences.
- **WRITE** — stores the working pattern into its slot; ◀PTN/PTN▶ navigate
  slots (switches are quantized to pattern end while playing).
- **SONG** — chain patterns: pick a song slot, `+ PTN` appends the current
  pattern slot to the chain, then press SONG mode and ▶.

## Development

```bash
npm install
npm run dev        # dev server
npm test           # vitest: sequencer timing, DSP stability, serialization,
                   # offline whole-engine render tests
npm run build      # type-check + production build (static, GitHub Pages ready)
node scripts/browser-check.mjs   # Playwright smoke test + screenshots
```

### Architecture

- `src/shared/` — data model, param registry, message protocol (imported by
  both threads and tests; no DOM, no audio APIs)
- `src/engine/worklet/` — the entire instrument inside one
  AudioWorkletProcessor: sequencer clock, voices, oscillators, effects, valve.
  Pure TypeScript, unit-testable offline (`EmxCore`)
- `src/state/` — single store with topic pub/sub; `actions.ts` is the only
  store→engine path, `engine-bridge.ts` the only engine→store path
- `src/ui/` — framework-free panel components (factory functions), canvas
  dot-matrix LCD, CSS-grid layouts for landscape/portrait
- `src/data/` — IndexedDB persistence + file export/import

The UI thread owns the edited pattern (source of truth); the worklet holds a
live copy and owns quantization during recording. All communication is typed
messages over the worklet port.
