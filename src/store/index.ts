import type { Config } from '../config.ts';
import { FirestoreStore } from './firestore.ts';
import { MemoryStore } from './memory.ts';
import type { Store } from './types.ts';

export function createStore(config: Config): Store {
  if (config.store === 'memory') return new MemoryStore();
  return new FirestoreStore({
    collection: config.collection,
    derivedCollection: config.derivedCollection,
    projectId: config.projectId,
    databaseId: config.databaseId,
  });
}

export type { Store, TranscriptStore } from './types.ts';
