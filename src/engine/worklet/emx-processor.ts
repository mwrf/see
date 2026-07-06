/**
 * AudioWorkletProcessor entry — a thin wrapper around EmxCore.
 * Everything interesting lives in core.ts (which is testable offline).
 */

import type { ToEngine } from '../../shared/messages';
import { EmxCore } from './core';

class EmxProcessor extends AudioWorkletProcessor {
  private core: EmxCore;

  constructor() {
    super();
    this.core = new EmxCore(sampleRate, (msg, transfer) => {
      this.port.postMessage(msg, transfer ?? []);
    });
    this.port.onmessage = (e: MessageEvent<ToEngine>) => {
      this.core.handle(e.data);
    };
    this.port.postMessage({ t: 'READY' });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (out && out[0] && out[1]) {
      this.core.render(out[0], out[1]);
    }
    return true;
  }
}

registerProcessor('emx-processor', EmxProcessor);
