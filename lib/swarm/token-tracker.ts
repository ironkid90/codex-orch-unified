export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TokenUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface SessionTokenUsage extends TokenUsage {
  sessionId: string;
  updatedAt: string;
}

export interface AggregateTokenUsage extends TokenUsage {
  sessionCount: number;
}

export function createTokenUsage(inputTokens = 0, outputTokens = 0): TokenUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function normalizeTokenUsage(usage?: TokenUsageLike | null): TokenUsage {
  const inputTokens = Math.max(0, Math.trunc(usage?.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.trunc(usage?.outputTokens ?? 0));
  const explicitTotal = usage?.totalTokens;
  const totalTokens =
    explicitTotal === undefined || explicitTotal === null
      ? inputTokens + outputTokens
      : Math.max(0, Math.trunc(explicitTotal));

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function addTokenUsage(left: TokenUsageLike, right: TokenUsageLike): TokenUsage {
  const normalizedLeft = normalizeTokenUsage(left);
  const normalizedRight = normalizeTokenUsage(right);
  return {
    inputTokens: normalizedLeft.inputTokens + normalizedRight.inputTokens,
    outputTokens: normalizedLeft.outputTokens + normalizedRight.outputTokens,
    totalTokens: normalizedLeft.totalTokens + normalizedRight.totalTokens,
  };
}

export function subtractTokenUsage(left: TokenUsageLike, right: TokenUsageLike): TokenUsage {
  const normalizedLeft = normalizeTokenUsage(left);
  const normalizedRight = normalizeTokenUsage(right);
  return {
    inputTokens: Math.max(0, normalizedLeft.inputTokens - normalizedRight.inputTokens),
    outputTokens: Math.max(0, normalizedLeft.outputTokens - normalizedRight.outputTokens),
    totalTokens: Math.max(0, normalizedLeft.totalTokens - normalizedRight.totalTokens),
  };
}

export class TokenTracker {
  private readonly sessionTotals = new Map<string, TokenUsage>();

  recordDelta(sessionId: string, delta: TokenUsageLike): TokenUsage {
    const normalizedDelta = normalizeTokenUsage(delta);
    const current = this.sessionTotals.get(sessionId) ?? createTokenUsage();
    const next = addTokenUsage(current, normalizedDelta);
    this.sessionTotals.set(sessionId, next);
    return next;
  }

  recordAbsolute(sessionId: string, absolute: TokenUsageLike): TokenUsage {
    const normalizedAbsolute = normalizeTokenUsage(absolute);
    this.sessionTotals.set(sessionId, normalizedAbsolute);
    return normalizedAbsolute;
  }

  getSessionTotals(sessionId: string): TokenUsage {
    return this.sessionTotals.get(sessionId) ?? createTokenUsage();
  }

  getAllSessionTotals(): SessionTokenUsage[] {
    const updatedAt = new Date().toISOString();
    return [...this.sessionTotals.entries()]
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
      .map(([sessionId, usage]) => ({
        sessionId,
        updatedAt,
        ...usage,
      }));
  }

  getAggregateTotals(): AggregateTokenUsage {
    let totals = createTokenUsage();
    for (const usage of this.sessionTotals.values()) {
      totals = addTokenUsage(totals, usage);
    }
    return {
      ...totals,
      sessionCount: this.sessionTotals.size,
    };
  }

  reset(): void {
    this.sessionTotals.clear();
  }
}
