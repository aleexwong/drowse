/**
 * JSON export, from day one, including full transcripts (PRD §11).
 *
 *   npm run export -- --out exports/drowse-2026-09-07.json
 *
 * Firebase is not a backup. Run this on a schedule and keep the file somewhere
 * you control. Losing the corpus is the worst realistic failure, and it gets
 * worse every month.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.ts';
import { buildExport } from './http.ts';
import { createStore } from './store/index.ts';

const { values } = parseArgs({
  options: { out: { type: 'string', short: 'o' } },
  allowPositionals: false,
});

const config = loadConfig({ requireToken: false });
const store = createStore(config);

try {
  const transcripts = await store.listAll();
  const payload = JSON.stringify(buildExport(transcripts), null, 2);

  if (values.out) {
    await mkdir(dirname(values.out), { recursive: true });
    await writeFile(values.out, payload, 'utf8');
    console.error(`Exported ${transcripts.length} transcript(s) to ${values.out}`);
  } else {
    process.stdout.write(`${payload}\n`);
  }
} finally {
  await store.close();
}
