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

export interface Config {
  port: number;
  token: string;
  timezone: string;
  defaultPhase: Phase;
  store: 'firestore' | 'memory';
  collection: string;
  derivedCollection: string;
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
