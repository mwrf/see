/**
 * File export/import — the SmartMedia card replacement.
 * Whole-device dumps (.emxweb.json) and single-pattern files.
 */

import type { EmxFile, GlobalSettings, Pattern, Song } from '../shared/model';
import { migrateFile, migratePattern } from '../shared/model';

export function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function exportAll(patterns: (Pattern | null)[], songs: (Song | null)[], global: GlobalSettings): void {
  const file: EmxFile = { magic: 'EMX-WEB', version: 1, patterns, songs, global };
  download('emx-web-alldata.emxweb.json', JSON.stringify(file));
}

export function exportPattern(pattern: Pattern): void {
  const safe = pattern.name.replace(/[^a-z0-9-]+/gi, '_').toLowerCase() || 'pattern';
  download(`emx-web-${safe}.emxpat.json`, JSON.stringify({ magic: 'EMX-WEB-PATTERN', version: 1, pattern }));
}

export async function pickFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve(await f.text());
    };
    // cancel: resolve null when the dialog closes without a file (best effort)
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export function parseImport(text: string): { kind: 'all'; file: EmxFile } | { kind: 'pattern'; pattern: Pattern } {
  const raw = JSON.parse(text) as { magic?: string; pattern?: unknown };
  if (raw.magic === 'EMX-WEB-PATTERN') {
    return { kind: 'pattern', pattern: migratePattern(raw.pattern) };
  }
  return { kind: 'all', file: migrateFile(raw) };
}
