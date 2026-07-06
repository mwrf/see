/**
 * Message protocol between the UI thread and the audio worklet.
 * The store is the source of truth for edited data; the worklet keeps a live
 * copy. The only reverse-direction data mutations are the realtime-record
 * echoes (RECORDED / MOTION_RECORDED), because the worklet owns quantization.
 */

import type { DrumStep, MotionSeq, MotionTarget, PartId, Pattern, Song, Step } from './model';

export type TransportAction = 'play' | 'stop' | 'pause' | 'recOn' | 'recOff';

export type ToEngine =
  | { t: 'LOAD_ROM'; waves: Float32Array[] } // procedural drum ROM, transferred from main thread
  | { t: 'SELECT_PART'; partId: PartId }
  | { t: 'SET_PATTERN'; pattern: Pattern }
  | { t: 'SET_NEXT_PATTERN'; pattern: Pattern; slot: number }
  | { t: 'EDIT_STEP'; partId: PartId; step: number; data: Step | DrumStep }
  | { t: 'SET_PARAM'; target: MotionTarget; paramId: string; value: number }
  | { t: 'SET_TEMPO'; bpm: number }
  | { t: 'SET_SWING'; value: number }
  | { t: 'TRANSPORT'; action: TransportAction }
  | { t: 'SET_METRONOME'; mode: 0 | 1 | 2 } // off / while recording / always
  | { t: 'TRANSPOSE'; semis: number } // live performance transpose, -24..+24
  | { t: 'RESET' } // restart the pattern from its beginning during playback
  | { t: 'ERASE_HOLD'; on: boolean } // erase selected part's triggers while held
  | { t: 'NOTE_ON'; partId: PartId; note: number }
  | { t: 'NOTE_OFF'; partId: PartId }
  | { t: 'TRIG'; partId: PartId }
  | { t: 'RIBBON'; value: number | null } // 0..1 position, null = release
  | { t: 'SLIDER'; value: number } // 0..1
  | { t: 'MUTE'; partId: PartId; on: boolean }
  | { t: 'SOLO'; partId: PartId | null; on: boolean } // null + on=false clears all solos
  | { t: 'SET_MOTION_MODE'; partId: PartId; mode: 0 | 1 }
  | { t: 'CLEAR_MOTION'; index: number }
  | { t: 'SET_SONG'; song: Song | null; patterns: Record<number, Pattern> }
  | { t: 'SONG_POS'; position: number }
  | { t: 'MODE'; mode: 'pattern' | 'song' };

export type FromEngine =
  | { t: 'READY' }
  | { t: 'POSITION'; step: number; bar: number; songPos: number; playing: boolean }
  | { t: 'RECORDED'; partId: PartId; step: number; data: Step | DrumStep }
  | { t: 'MOTION_RECORDED'; motion: MotionSeq }
  | { t: 'PATTERN_SWITCHED'; slot: number }
  | { t: 'SONG_ENDED'; nextSong: number }
  | { t: 'LEVELS'; l: number; r: number };
