/**
 * Quick-log CLI — the path with no model in it at all.
 *
 *   npm run caffeine -- --list
 *   npm run caffeine -- --preset flat-white --at 14:00
 *   npm run caffeine -- --preset espresso --at 08:15 --count 2 --date 2026-09-06
 *
 * Talking is the main way in, and it should stay that way: the corpus is the
 * point (PRD §1). But nothing about recording a drink actually requires a
 * conversation, and a tracker you can only reach through an LLM is a tracker you
 * cannot use when the connector is down, when you are offline, or when you
 * simply do not want to narrate your morning.
 *
 * A preset expands to a plain sentence and goes through the same store and the
 * same extractor as everything else. No shortcut, no second data path.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './config.ts';
import { QuickLogError } from './extract/index.ts';
import { createStore } from './store/index.ts';
import { logCaffeine, logCaffeineSchema, presetTable } from './tools/logCaffeine.ts';

const { values } = parseArgs({
  options: {
    preset: { type: 'string', short: 'p' },
    at: { type: 'string', short: 'a' },
    count: { type: 'string', short: 'c' },
    date: { type: 'string', short: 'd' },
    list: { type: 'boolean', short: 'l' },
  },
  allowPositionals: false,
});

const config = loadConfig({ requireToken: false });

if (values.list) {
  console.log(presetTable(config));
  process.exit(0);
}

if (!values.preset || !values.at) {
  console.error(
    'Usage: npm run caffeine -- --preset <id> --at HH:MM [--count N] [--date YYYY-MM-DD]\n' +
      '       npm run caffeine -- --list',
  );
  process.exit(2);
}

const parsed = logCaffeineSchema.safeParse({
  preset: values.preset,
  at: values.at,
  ...(values.count ? { count: Number(values.count) } : {}),
  ...(values.date ? { date: values.date } : {}),
});

if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    console.error(`${issue.path.join('.') || 'input'}: ${issue.message}`);
  }
  process.exit(2);
}

const store = createStore(config);
try {
  const { confirmation } = await logCaffeine(parsed.data, store, config);
  console.log(confirmation);
} catch (error) {
  if (error instanceof QuickLogError) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
} finally {
  await store.close();
}
