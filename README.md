# EMX-Web — Korg Electribe MX (EMX-1) Emulator

A full-featured, web-based emulation of the Korg Electribe MX music production
station: sound engine, sequencer, effects, and front panel. Runs entirely in
the browser (desktop and mobile, landscape and portrait) with no assets to
download — the whole drum ROM and all wavetables are synthesized procedurally
at boot.

## Features

**Sound engine** (single AudioWorklet, sample-accurate)
- 5 synth parts with 16 MMT-style oscillator algorithms: Waveform, Dual,
  Unison, Sync, Ring, X-Mod, VPM, Noise, PCM (76 single-cycle waves), Chord,
  Comb, Formant, PWM, Super-7, Additive, Mod-Noise
- 9 drum parts drawing from a 207-wave procedural drum ROM (kicks, snares,
  claps, hats, cymbals, toms, percussion, hits)
- Per part: multimode filter (LPF/HPF/BPF/BPF+) with resonance + EG, amp EG
  (gate/decay), level, pan, roll, accent, glide (synths), LFO with 6 waves,
  5 destinations, BPM sync and key sync
- 3 effect processors × 16 types (reverb, short/BPM/mod delay, grain shifter,
  chorus/flanger, phaser, ring mod, talk mod, pitch shifter, compressor,
  distortion, decimator, EQ, LPF, HPF) with chain routing 1→2→3
- Valve Force tube stage emulation (2× oversampled asymmetric waveshaper)

**Sequencer**
- 256 pattern slots (A.01–D.64), 1–8 bars, beat modes 16/32/8-tri/16-tri
- Swing 50–75 %, accent part, roll retrigger
- Motion sequences (knob automation) with SMOOTH / TRIG HOLD playback
- Realtime + quantized recording, quantized next-pattern switching
- Song mode: 64 songs of chained pattern events
- Ribbon + slider arpeggiator (scale-aware for synth parts, roll for drums)
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
