/**
 * Audio engine bootstrap on the main thread: creates the AudioContext,
 * loads the worklet module, renders + transfers the procedural drum ROM,
 * and exposes a typed message port to the engine.
 */

import type { FromEngine, ToEngine } from '../shared/messages';
import { renderDrumRom } from './worklet/drum-rom';
// `?worker&url` makes Vite compile + bundle the worklet (TS + imports) into a
// standalone ES module and hands us its URL — exactly what addModule() needs.
import workletUrl from './worklet/emx-processor.ts?worker&url';

export interface Engine {
  send(msg: ToEngine, transfer?: Transferable[]): void;
  onMessage(cb: (msg: FromEngine) => void): void;
  readonly ctx: AudioContext;
}

let engine: Engine | null = null;

export async function startEngine(): Promise<Engine> {
  if (engine) {
    if (engine.ctx.state === 'suspended') await engine.ctx.resume();
    return engine;
  }
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, 'emx-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.connect(ctx.destination);

  const listeners: ((msg: FromEngine) => void)[] = [];
  node.port.onmessage = (e: MessageEvent<FromEngine>) => {
    for (const cb of listeners) cb(e.data);
  };

  engine = {
    ctx,
    send(msg, transfer) {
      node.port.postMessage(msg, transfer ?? []);
    },
    onMessage(cb) {
      listeners.push(cb);
    },
  };

  // Render the procedural drum ROM here (main thread, pre-playback) and
  // transfer the buffers into the worklet so its constructor stays instant.
  const waves = renderDrumRom(ctx.sampleRate).map((w) => w.data);
  engine.send({ t: 'LOAD_ROM', waves }, waves.map((w) => w.buffer));

  if (ctx.state === 'suspended') await ctx.resume();
  return engine;
}

export function getEngine(): Engine | null {
  return engine;
}
