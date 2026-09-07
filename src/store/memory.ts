import type { DerivedEntry, Store, Transcript } from './types.ts';

/** In-process store for tests and local smoke runs. Loses everything on exit. */
export class MemoryStore implements Store {
  readonly #byId = new Map<string, Transcript>();
  readonly #derivedById = new Map<string, DerivedEntry>();

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

  async putDerived(entry: DerivedEntry): Promise<void> {
    // Overwrite on purpose — derived records are regenerable (PRD §2.1).
    this.#derivedById.set(entry.transcriptId, { ...entry });
  }

  async listAllDerived(): Promise<DerivedEntry[]> {
    return [...this.#derivedById.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.transcriptId.localeCompare(b.transcriptId),
    );
  }

  async close(): Promise<void> {}
}
