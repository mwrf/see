/**
 * Persistence: autosave of the working pattern + explicit WRITE-to-slot,
 * song storage, and global settings — all in IndexedDB.
 */

import type { GlobalSettings, Pattern, Song } from '../shared/model';
import { migratePattern, NUM_PATTERN_SLOTS, NUM_SONG_SLOTS } from '../shared/model';
import { dbClear, dbDelete, dbGet, dbGetAll, dbPut } from './db';

const WORKING_KEY = '__working__';

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced autosave of the working (edit-buffer) pattern. */
export function autosaveWorkingPattern(pattern: Pattern, slot: number): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    void dbPut('patterns', WORKING_KEY, { pattern, slot });
  }, 1000);
}

export async function loadWorkingPattern(): Promise<{ pattern: Pattern; slot: number } | null> {
  try {
    const raw = await dbGet<{ pattern: unknown; slot: number }>('patterns', WORKING_KEY);
    if (!raw) return null;
    return { pattern: migratePattern(raw.pattern), slot: raw.slot ?? 0 };
  } catch {
    return null;
  }
}

export async function writePatternSlot(slot: number, pattern: Pattern): Promise<void> {
  await dbPut('patterns', slot, pattern);
}

export async function readPatternSlot(slot: number): Promise<Pattern | null> {
  try {
    const raw = await dbGet('patterns', slot);
    return raw ? migratePattern(raw) : null;
  } catch {
    return null;
  }
}

export async function deletePatternSlot(slot: number): Promise<void> {
  await dbDelete('patterns', slot);
}

export async function readAllPatterns(): Promise<(Pattern | null)[]> {
  const out: (Pattern | null)[] = Array.from({ length: NUM_PATTERN_SLOTS }, () => null);
  const map = await dbGetAll<unknown>('patterns');
  for (const [k, v] of map) {
    if (typeof k === 'number' && k >= 0 && k < NUM_PATTERN_SLOTS) {
      try {
        out[k] = migratePattern(v);
      } catch {
        out[k] = null;
      }
    }
  }
  return out;
}

export async function writeSongSlot(slot: number, song: Song): Promise<void> {
  await dbPut('songs', slot, song);
}

export async function readSongSlot(slot: number): Promise<Song | null> {
  return ((await dbGet<Song>('songs', slot)) as Song | undefined) ?? null;
}

export async function readAllSongs(): Promise<(Song | null)[]> {
  const out: (Song | null)[] = Array.from({ length: NUM_SONG_SLOTS }, () => null);
  const map = await dbGetAll<Song>('songs');
  for (const [k, v] of map) {
    if (typeof k === 'number' && k >= 0 && k < NUM_SONG_SLOTS) out[k] = v;
  }
  return out;
}

export async function writeGlobal(g: GlobalSettings): Promise<void> {
  await dbPut('global', 'settings', g);
}

export async function readGlobal(): Promise<GlobalSettings | null> {
  return ((await dbGet<GlobalSettings>('global', 'settings')) as GlobalSettings | undefined) ?? null;
}

export async function wipeAll(): Promise<void> {
  await Promise.all([dbClear('patterns'), dbClear('songs'), dbClear('global')]);
}
