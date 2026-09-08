import { createHash } from 'node:crypto';
import { post } from './cloud-http.js';
import { CloudError } from './cloud-error.js';
import { Budget, deadline, systemClock, type CloudClock } from './cloud-time.js';
import {
  commandBody,
  credentialsFor,
  originFor,
  readCall,
  sessionFrom,
  type Command,
  type Credentials,
  type ReadRequest,
  type Session,
} from './cloud-protocol.js';
export type { Command, Credentials, ReadRequest } from './cloud-protocol.js';

export interface ClientOptions {
  origin?: string;
  requestTimeoutMs?: number;
  readBudgetMs?: number;
  writeBudgetMs?: number;
  clock?: CloudClock;
}

export class AquaTempClient {
  #credentials: Credentials;
  #origin: string;
  #session: Session | undefined;
  #login: Promise<Session> | undefined;
  #shutdown = new AbortController();
  #paused: CloudError | undefined;
  #cooldownUntil = 0;
  #clock: CloudClock;
  #requestTimeout: number;
  #readBudget: number;
  #writeBudget: number;
  #failures = 0;
  #notBefore = 0;
  #transient: CloudError | undefined;
  #invalidations: number[] = [];

  constructor(credentials: Credentials, options: ClientOptions = {}) {
    this.#credentials = credentialsFor(credentials);
    this.#origin = originFor(options.origin);
    this.#clock = options.clock ?? systemClock;
    this.#requestTimeout = deadline(options.requestTimeoutMs, 10_000);
    this.#readBudget = deadline(options.readBudgetMs, 30_000);
    this.#writeBudget = deadline(options.writeBudgetMs, 8000);
  }

  close(): void {
    this.#shutdown.abort();
    this.#session = undefined;
  }

  /** Transport acknowledgment only, never evidence of physical actuation. No write is replayed. */
  async write(commands: Command[], options: { signal?: AbortSignal } = {}): Promise<unknown> {
    this.checkAccess();
    const body = commandBody(commands);
    const budget = new Budget(this.#writeBudget, this.#clock, [
      this.#shutdown.signal,
      ...(options.signal ? [options.signal] : []),
    ]);
    let dispatched = false;
    try {
      budget.check();
      await this.waitBackoff(budget);
      const session = await budget.wait(this.authenticate());
      this.checkAccess();
      budget.check();
      dispatched = true;
      try {
        const result = await this.request(
          '/crmservice/api/app/device/control',
          body,
          budget,
          session.token,
        );
        this.#failures = 0;
        return result;
      } catch (error) {
        if (error instanceof CloudError && error.category === 'session-expired')
          this.invalidate(session);
        throw error;
      }
    } catch (error) {
      this.pauseIfDenied(error, false);
      let safe = error instanceof CloudError ? error : new CloudError('invalid-request');
      if (dispatched && this.isTransient(safe)) safe = this.backoff(safe);
      throw new CloudError(safe.category, safe.retryAfterMs, dispatched);
    } finally {
      budget.dispose();
    }
  }

  async read(request: ReadRequest, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    this.checkAccess();
    // Snapshot caller-owned input before awaiting authentication.
    const operation = readCall(request, { userId: '', appId: '' });
    const budget = new Budget(this.#readBudget, this.#clock, [
      this.#shutdown.signal,
      ...(options.signal ? [options.signal] : []),
    ]);
    try {
      budget.check();
      await this.waitBackoff(budget);
      let session = await budget.wait(this.authenticate());
      let renewed = false;
      let retries = 0;
      for (;;) {
        this.checkAccess();
        await this.waitBackoff(budget);
        try {
          const body = {
            ...operation.body,
            appId: session.appId,
            ...('toUser' in operation.body
              ? { toUser: session.userId }
              : { userId: session.userId }),
          };
          const result = await this.request(operation.path, body, budget, session.token);
          this.#failures = 0;
          return result;
        } catch (error) {
          this.pauseIfDenied(error, !('deviceCode' in operation.body));
          if (error instanceof CloudError && this.isTransient(error)) {
            const failure = this.backoff(error);
            if (renewed || retries >= 2) throw failure;
            retries += 1;
            continue;
          }
          if (!(error instanceof CloudError) || error.category !== 'session-expired') throw error;
          this.invalidate(session);
          if (renewed) {
            this.cooldown();
          }
          renewed = true;
          session = await budget.wait(this.authenticate());
        }
      }
    } finally {
      budget.dispose();
    }
  }

  private invalidate(session: Session): void {
    if (this.#session !== session) return;
    this.#session = undefined;
    const now = this.#clock.now();
    this.#invalidations = this.#invalidations.filter((time) => now - time < 60_000);
    this.#invalidations.push(now);
    if (this.#invalidations.length >= 3) this.cooldown();
  }

  private cooldown(): never {
    this.#cooldownUntil = this.#clock.now() + 300_000;
    this.#session = undefined;
    this.#invalidations = [];
    throw new CloudError('session-contention', 300_000);
  }

  private async authenticate(): Promise<Session> {
    this.checkAccess();
    if (this.#session) return this.#session;
    this.#login ??= this.login()
      .catch((error: unknown) => {
        this.pauseIfDenied(error);
        if (error instanceof CloudError && error.category === 'session-expired') this.cooldown();
        if (error instanceof CloudError && this.isTransient(error)) throw this.backoff(error);
        throw error;
      })
      .finally(() => {
        this.#login = undefined;
      });
    return this.#login;
  }

  private isTransient(error: CloudError): boolean {
    return (
      error.category === 'unavailable' ||
      error.category === 'rate-limited' ||
      error.category === 'timeout'
    );
  }

  private backoff(error: CloudError): CloudError {
    const delay = Math.max(
      error.retryAfterMs,
      Math.min(300_000, 5000 * 2 ** Math.min(this.#failures, 6) * (1 + 0.2 * this.#clock.random())),
    );
    this.#failures = Math.min(6, this.#failures + 1);
    this.#notBefore = Math.max(this.#notBefore, this.#clock.now() + delay);
    this.#transient = new CloudError(error.category, this.#notBefore - this.#clock.now());
    return this.#transient;
  }

  private async waitBackoff(budget: Budget): Promise<void> {
    while (this.#notBefore > this.#clock.now()) {
      const delay = this.#notBefore - this.#clock.now();
      budget.check();
      if (delay >= budget.remaining())
        throw new CloudError(this.#transient?.category ?? 'unavailable', delay);
      await budget.wait(this.#clock.sleep(delay, budget.signal));
    }
    budget.check();
  }

  private checkAccess(): void {
    if (this.#shutdown.signal.aborted) throw new CloudError('cancelled');
    if (this.#paused) throw this.#paused;
    if (this.#cooldownUntil > this.#clock.now())
      throw new CloudError('session-contention', this.#cooldownUntil - this.#clock.now());
  }

  private pauseIfDenied(error: unknown, accountScope = true): void {
    if (
      error instanceof CloudError &&
      (error.category === 'invalid-credentials' ||
        (accountScope && error.category === 'permission-denied'))
    ) {
      this.#paused = error;
      this.#session = undefined;
    }
  }

  private async login(): Promise<Session> {
    const budget = new Budget(this.#requestTimeout, this.#clock, [this.#shutdown.signal]);
    try {
      const value = await this.request(
        '/crmservice/api/app/user/login',
        {
          userName: this.#credentials.username,
          password: createHash('md5').update(this.#credentials.password, 'utf8').digest('hex'),
          type: '2',
        },
        budget,
      );
      this.#session = sessionFrom(value);
      return this.#session;
    } finally {
      budget.dispose();
    }
  }

  private async request(
    path: string,
    body: unknown,
    operation: Budget,
    token?: string,
  ): Promise<unknown> {
    this.checkAccess();
    operation.check();
    const budget = new Budget(Math.min(this.#requestTimeout, operation.remaining()), this.#clock, [
      operation.signal,
    ]);
    try {
      return await operation.wait(
        budget.wait(
          post({
            origin: this.#origin,
            path,
            body,
            ...(token ? { token } : {}),
            signal: budget.signal,
            now: () => this.#clock.now(),
          }),
        ),
      );
    } finally {
      budget.dispose();
    }
  }
}
