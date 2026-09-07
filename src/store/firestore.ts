import { Firestore, type Settings } from '@google-cloud/firestore';
import type { Transcript, TranscriptStore } from './types.ts';

export interface FirestoreStoreOptions {
  collection: string;
  projectId?: string | undefined;
  databaseId?: string | undefined;
}

export class FirestoreStore implements TranscriptStore {
  readonly #db: Firestore;
  readonly #collection: string;

  constructor(options: FirestoreStoreOptions) {
    const settings: Settings = { ignoreUndefinedProperties: false };
    if (options.projectId) settings.projectId = options.projectId;
    if (options.databaseId && options.databaseId !== '(default)') {
      settings.databaseId = options.databaseId;
    }
    this.#db = new Firestore(settings);
    this.#collection = options.collection;
  }

  async append(transcript: Transcript): Promise<void> {
    // `create` fails if the document already exists, which is what makes the
    // collection append-only from the server's side. Security rules block every
    // client write (see firestore.rules), so this is the only writer.
    await this.#db.collection(this.#collection).doc(transcript.id).create(transcript);
  }

  async listAll(): Promise<Transcript[]> {
    const snapshot = await this.#db
      .collection(this.#collection)
      .orderBy('date')
      .orderBy('capturedAt')
      .get();
    return snapshot.docs.map((doc) => doc.data() as Transcript);
  }

  async close(): Promise<void> {
    await this.#db.terminate();
  }
}
