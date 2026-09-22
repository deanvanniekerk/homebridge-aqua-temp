import { bounded, type Scheduler } from './scheduler.js';

export class CommandError extends Error {
  constructor(readonly category: 'busy' | 'unconfirmed') {
    super(
      category === 'busy'
        ? 'The device command queue is full. Try again after the pending command finishes.'
        : 'The requested state was not confirmed. Refresh before issuing another command.',
    );
    this.name = 'CommandError';
  }
}

/** Serializes device operations; each deadline includes time waiting behind another command. */
export class DeviceCommandQueue {
  readonly #tails = new Map<string, Promise<void>>();
  readonly #jobs = new Map<string, Set<AbortController>>();
  readonly #revisions = new Map<string, number>();
  readonly #active = new Set<string>();
  readonly #running = new Set<string>();

  constructor(
    readonly scheduler: Scheduler,
    readonly shutdown: AbortSignal,
  ) {}

  revision(id: string): number {
    return this.#revisions.get(id) ?? 0;
  }

  acceptsPoll(id: string, revision: number): boolean {
    return !this.#active.has(id) && this.revision(id) === revision;
  }

  async run<T>(id: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const jobs = this.#jobs.get(id) ?? new Set<AbortController>();
    if (jobs.size >= 4 || (this.#running.has(id) && !this.#active.has(id)))
      throw new CommandError('busy');
    const controller = new AbortController();
    jobs.add(controller);
    this.#jobs.set(id, jobs);
    const previous = this.#tails.get(id) ?? Promise.resolve();
    let started = false;
    const result = bounded(
      this.scheduler,
      8000,
      AbortSignal.any([this.shutdown, controller.signal]),
      async (signal) => {
        await previous;
        signal.throwIfAborted();
        started = true;
        this.#active.add(id);
        this.#running.add(id);
        this.#revisions.set(id, this.revision(id) + 1);
        try {
          return await work(signal);
        } finally {
          this.#running.delete(id);
          // Invalidate polls started after timeout but before this late completion.
          if (signal.aborted) this.#revisions.set(id, this.revision(id) + 1);
        }
      },
    );
    const finish = (failed: boolean) => {
      if (!started) return;
      this.#active.delete(id);
      this.#revisions.set(id, this.revision(id) + 1);
      // A failed active command invalidates pending intent; never replay it after recovery.
      if (failed) for (const job of jobs) if (job !== controller) job.abort();
    };
    const tail = result
      .then(
        () => {
          finish(false);
        },
        () => {
          finish(true);
        },
      )
      .finally(() => {
        jobs.delete(controller);
        if (jobs.size === 0) this.#jobs.delete(id);
        if (this.#tails.get(id) === tail) this.#tails.delete(id);
      });
    this.#tails.set(id, tail);
    return result;
  }
}
