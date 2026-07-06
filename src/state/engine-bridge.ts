/**
 * Engine → store bridge: subscribes to worklet messages and mirrors them
 * into the store (playhead position, realtime-record echoes, pattern
 * switches, level meters). The store → engine direction lives in actions.ts.
 */

import type { Engine } from '../engine/audio-context';
import type { DrumPartId, Step, SynthPartId } from '../shared/model';
import { DRUM_PART_IDS, SYNTH_PART_IDS } from '../shared/model';
import { store } from './store';

export function attachEngineBridge(engine: Engine): void {
  engine.onMessage((msg) => {
    switch (msg.t) {
      case 'READY':
        store.update(['ui'], (s) => {
          s.audioStarted = true;
        });
        break;
      case 'POSITION':
        store.update(['playhead'], (s) => {
          s.playhead.step = msg.step;
          s.playhead.bar = msg.bar;
          s.playhead.songPos = msg.songPos;
          s.playhead.playing = msg.playing;
        });
        break;
      case 'RECORDED': {
        store.update(['steps'], (s) => {
          if ((SYNTH_PART_IDS as string[]).includes(msg.partId)) {
            s.pattern.synths[msg.partId as SynthPartId].steps[msg.step] = msg.data as Step;
          } else if ((DRUM_PART_IDS as string[]).includes(msg.partId)) {
            s.pattern.drums[msg.partId as DrumPartId].steps[msg.step] = { on: (msg.data as Step).on };
          } else if (msg.partId === 'ACCD') {
            s.pattern.accentDrum.steps[msg.step] = { on: (msg.data as Step).on };
          } else if (msg.partId === 'ACCS') {
            s.pattern.accentSynth.steps[msg.step] = { on: (msg.data as Step).on };
          }
          s.patternDirty = true;
        });
        break;
      }
      case 'MOTION_RECORDED':
        store.update(['pattern', 'lcd'], (s) => {
          const idx = s.pattern.motions.findIndex(
            (m) => m.target === msg.motion.target && m.paramId === msg.motion.paramId,
          );
          if (idx >= 0) s.pattern.motions[idx] = msg.motion;
          else if (s.pattern.motions.length < 24) s.pattern.motions.push(msg.motion);
          s.patternDirty = true;
          s.lcd.line1 = 'MOTION REC';
          s.lcd.line2 = msg.motion.paramId.toUpperCase();
        });
        break;
      case 'PATTERN_SWITCHED':
        store.update(['ui', 'pattern', 'steps', 'lcd'], (s) => {
          s.patternSlot = msg.slot;
        });
        break;
      case 'SONG_ENDED':
        store.update(['playhead', 'lcd'], (s) => {
          s.playhead.playing = false;
          s.lcd.line1 = 'SONG';
          s.lcd.line2 = 'END';
        });
        // NEXT SONG chaining (manual p.71)
        if (msg.nextSong >= 0) {
          void (async () => {
            const { loadSong, play, syncSongToEngine } = await import('./actions');
            await loadSong(msg.nextSong);
            await syncSongToEngine();
            engine.send({ t: 'MODE', mode: 'song' });
            play();
          })();
        }
        break;
      case 'LEVELS':
        store.update(['levels'], (s) => {
          s.levels.l = msg.l;
          s.levels.r = msg.r;
        });
        break;
    }
  });
}
