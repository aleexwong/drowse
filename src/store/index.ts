import type { Config } from '../config.ts';
import { FirestoreStore } from './firestore.ts';
import { MemoryStore } from './memory.ts';
import type { TranscriptStore } from './types.ts';

export function createStore(config: Config): TranscriptStore {
  if (config.store === 'memory') return new MemoryStore();
  return new FirestoreStore({
    collection: config.collection,
    projectId: config.projectId,
    databaseId: config.databaseId,
  });
}

export type { TranscriptStore };
