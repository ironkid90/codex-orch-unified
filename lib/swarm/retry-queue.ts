export interface RetryQueueEntry {
  issueId: string;
  issueIdentifier: string;
  attempt: number;
  dueAtMs: number;
  lastError?: string;
}

export interface RetryQueueOptions {
  maxRetryBackoffMs?: number;
}

const DEFAULT_MAX_RETRY_BACKOFF_MS = 300_000;

export class RetryQueue {
  private readonly entries = new Map<string, RetryQueueEntry>();
  private readonly maxRetryBackoffMs: number;

  constructor(options: RetryQueueOptions = {}) {
    this.maxRetryBackoffMs = options.maxRetryBackoffMs ?? DEFAULT_MAX_RETRY_BACKOFF_MS;
  }

  static calculateDelay(attempt: number, maxRetryBackoffMs = DEFAULT_MAX_RETRY_BACKOFF_MS): number {
    const safeAttempt = Math.max(1, Math.trunc(attempt));
    const exponent = safeAttempt - 1;
    return Math.min(10_000 * 2 ** exponent, maxRetryBackoffMs);
  }

  schedule(issueId: string, issueIdentifier: string, attempt: number, lastError?: string): RetryQueueEntry {
    const delayMs = RetryQueue.calculateDelay(attempt, this.maxRetryBackoffMs);
    const entry: RetryQueueEntry = {
      issueId,
      issueIdentifier,
      attempt: Math.max(1, Math.trunc(attempt)),
      dueAtMs: Date.now() + delayMs,
      lastError,
    };
    this.entries.set(issueId, entry);
    return entry;
  }

  cancel(issueId: string): boolean {
    return this.entries.delete(issueId);
  }

  peek(issueId: string): RetryQueueEntry | null {
    return this.entries.get(issueId) ?? null;
  }

  popReady(issueId: string, nowMs = Date.now()): RetryQueueEntry | null {
    const entry = this.entries.get(issueId);
    if (!entry || entry.dueAtMs > nowMs) {
      return null;
    }
    this.entries.delete(issueId);
    return entry;
  }

  drainReady(nowMs = Date.now()): RetryQueueEntry[] {
    const readyEntries: RetryQueueEntry[] = [];
    for (const [issueId, entry] of this.entries) {
      if (entry.dueAtMs <= nowMs) {
        readyEntries.push(entry);
        this.entries.delete(issueId);
      }
    }
    readyEntries.sort((left, right) => left.dueAtMs - right.dueAtMs);
    return readyEntries;
  }

  list(): RetryQueueEntry[] {
    return [...this.entries.values()].sort((left, right) => left.dueAtMs - right.dueAtMs);
  }

  size(): number {
    return this.entries.size;
  }

  nextDueInMs(nowMs = Date.now()): number | null {
    const firstEntry = this.list()[0];
    if (!firstEntry) {
      return null;
    }
    return Math.max(0, firstEntry.dueAtMs - nowMs);
  }

  clear(): void {
    this.entries.clear();
  }
}
