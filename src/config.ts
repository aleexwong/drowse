import { readFileSync } from 'node:fs';
import { PresetError, loadPresets, type CaffeinePreset } from './extract/presets.ts';
import type { Phase } from './store/types.ts';

const PHASES = ['baseline', 'intervention', 'washout'] as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function phase(name: string, fallback: Phase): Phase {
  const value = process.env[name];
  if (!value) return fallback;
  if (!(PHASES as readonly string[]).includes(value)) {
    throw new Error(`${name} must be one of ${PHASES.join(', ')} — got "${value}"`);
  }
  return value as Phase;
}

function timezone(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
  } catch {
    throw new Error(`${name} is not a valid IANA time zone: "${value}"`);
  }
  return value;
}

/**
 * Read the preset catalogue. A bad file is fatal at startup rather than silently
 * falling back to the defaults: your own milligrams quietly reverting to
 * mid-range guesses is the kind of drift the whole versioning scheme exists to
 * make visible.
 */
function presets(path: string | undefined): CaffeinePreset[] {
  if (!path) return loadPresets();
  let json: string;
  try {
    json = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`DROWSE_PRESETS points at a file that cannot be read: ${path} (${String(error)})`);
  }
  try {
    return loadPresets(json);
  } catch (error) {
    if (error instanceof PresetError) throw new Error(`DROWSE_PRESETS (${path}): ${error.message}`);
    throw error;
  }
}

export interface Config {
  port: number;
  token: string;
  timezone: string;
  defaultPhase: Phase;
  store: 'firestore' | 'memory';
  collection: string;
  derivedCollection: string;
  /** The drink catalogue the extractor and the quick-log path both run on. */
  presets: CaffeinePreset[];
  projectId: string | undefined;
  databaseId: string | undefined;
}

export interface LoadConfigOptions {
  /** The export CLI talks to storage directly and needs no HTTP token. */
  requireToken?: boolean;
}

export function loadConfig(options: LoadConfigOptions = {}): Config {
  const { requireToken = true } = options;
  const store = process.env.DROWSE_STORE ?? 'firestore';
  if (store !== 'firestore' && store !== 'memory') {
    throw new Error(`DROWSE_STORE must be "firestore" or "memory" — got "${store}"`);
  }

  const token = requireToken ? required('DROWSE_TOKEN') : (process.env.DROWSE_TOKEN ?? '');
  if (requireToken && token.length < 24) {
    throw new Error('DROWSE_TOKEN is too short. Use at least 24 characters (openssl rand -hex 32).');
  }

  return {
    port: Number(process.env.PORT ?? 8080),
    token,
    timezone: timezone('DROWSE_TIMEZONE', 'UTC'),
    defaultPhase: phase('DROWSE_DEFAULT_PHASE', 'baseline'),
    store,
    collection: process.env.DROWSE_COLLECTION ?? 'transcripts',
    presets: presets(process.env.DROWSE_PRESETS),
    derivedCollection: process.env.DROWSE_DERIVED_COLLECTION ?? 'derived',
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    databaseId: process.env.FIRESTORE_DATABASE_ID,
  };
}

/** Today's calendar date in the configured zone, as YYYY-MM-DD. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
