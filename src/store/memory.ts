import type { Transcript, TranscriptStore } from './types.ts';

/** In-process store for tests and local smoke runs. Loses everything on exit. */
export class MemoryStore implements TranscriptStore {
  readonly #byId = new Map<string, Transcript>();

  async append(transcript: Transcript): Promise<void> {
    if (this.#byId.has(transcript.id)) {
      throw new Error(`Transcript ${transcript.id} already exists — transcripts are append-only.`);
    }
    this.#byId.set(transcript.id, { ...transcript });
  }

  async listAll(): Promise<Transcript[]> {
    return [...this.#byId.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.capturedAt.localeCompare(b.capturedAt),
    );
  }

  async close(): Promise<void> {}
}
