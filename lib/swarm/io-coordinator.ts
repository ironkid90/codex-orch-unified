// io-coordinator.ts
// Handles connection resilience, error normalization, rate-limiting, and token efficiency for external RPCs.

import {
    createIoCoordinatorDefaults,
    type IoContextOptimizationSnapshot,
    type IoCoordinatorLastError,
    type IoCoordinatorSnapshot,
    type IoOperationSnapshot,
} from "./types";

export interface RetryOptions {
    maxRetries?: number;
    initialBackoffMs?: number;
    maxBackoffMs?: number;
    backoffFactor?: number;
    retryableStatusRules?: (status?: number, error?: unknown) => boolean;
}

interface InternalOperationState extends IoOperationSnapshot {
    startedAtMs?: number;
}

export class IOCoordinator {
    private static snapshot: IoCoordinatorSnapshot = createIoCoordinatorDefaults();
    private static operations = new Map<string, InternalOperationState>();
    private static listener?: (snapshot: IoCoordinatorSnapshot) => void;

    private static getErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }

    private static getErrorStatus(error: unknown): number | undefined {
        if (!error || typeof error !== "object") {
            return undefined;
        }

        const directStatus = (error as { status?: unknown }).status;
        if (typeof directStatus === "number") {
            return directStatus;
        }

        const response = (error as { response?: unknown }).response;
        if (!response || typeof response !== "object") {
            return undefined;
        }

        const nestedStatus = (response as { status?: unknown }).status;
        return typeof nestedStatus === "number" ? nestedStatus : undefined;
    }

    private static getErrorCode(error: unknown): string | undefined {
        if (!error || typeof error !== "object") {
            return undefined;
        }
        const code = (error as { code?: unknown }).code;
        return typeof code === "string" ? code : undefined;
    }

    private static estimateContentLength(content: unknown): number {
        if (typeof content === "string") {
            return content.length;
        }

        try {
            return JSON.stringify(content ?? "").length;
        } catch {
            return String(content ?? "").length;
        }
    }

    private static cloneSnapshot(): IoCoordinatorSnapshot {
        return {
            ...IOCoordinator.snapshot,
            contextOptimization: { ...IOCoordinator.snapshot.contextOptimization },
            operations: IOCoordinator.snapshot.operations.map((operation) => ({ ...operation })),
            ...(IOCoordinator.snapshot.lastError ? { lastError: { ...IOCoordinator.snapshot.lastError } } : {}),
        };
    }

    private static publish(): void {
        IOCoordinator.snapshot.lastUpdatedAt = new Date().toISOString();
        IOCoordinator.snapshot.operations = [...IOCoordinator.operations.values()]
            .map(({ startedAtMs: _startedAtMs, ...operation }) => ({ ...operation }))
            .sort((left, right) => left.name.localeCompare(right.name));
        if (IOCoordinator.listener) {
            IOCoordinator.listener(IOCoordinator.cloneSnapshot());
        }
    }

    private static getOrCreateOperation(name: string): InternalOperationState {
        const existing = IOCoordinator.operations.get(name);
        if (existing) {
            return existing;
        }

        const created: InternalOperationState = {
            name,
            callCount: 0,
            successCount: 0,
            failureCount: 0,
            retryCount: 0,
            totalDurationMs: 0,
            averageDurationMs: 0,
            maxDurationMs: 0,
        };
        IOCoordinator.operations.set(name, created);
        return created;
    }

    private static buildLastError(operationName: string, error: unknown): IoCoordinatorLastError {
        const status = IOCoordinator.getErrorStatus(error);
        const code = IOCoordinator.getErrorCode(error);
        return {
            operationName,
            message: IOCoordinator.getErrorMessage(error),
            at: new Date().toISOString(),
            ...(status === undefined ? {} : { status }),
            ...(code ? { code } : {}),
        };
    }

    private static recordStart(operationName: string): InternalOperationState {
        const operation = IOCoordinator.getOrCreateOperation(operationName);
        operation.callCount += 1;
        operation.lastStartedAt = new Date().toISOString();
        operation.startedAtMs = Date.now();
        IOCoordinator.snapshot.totalCalls += 1;
        IOCoordinator.snapshot.activeCalls += 1;
        IOCoordinator.publish();
        return operation;
    }

    private static finalizeOperation(
        operation: InternalOperationState,
        attemptCount: number,
        wasSuccessful: boolean,
        error?: unknown,
    ): void {
        const now = Date.now();
        const durationMs = operation.startedAtMs === undefined ? 0 : Math.max(0, now - operation.startedAtMs);
        operation.lastDurationMs = durationMs;
        operation.totalDurationMs += durationMs;
        operation.averageDurationMs =
            operation.callCount === 0 ? 0 : operation.totalDurationMs / operation.callCount;
        operation.maxDurationMs = Math.max(operation.maxDurationMs, durationMs);
        operation.lastAttemptCount = attemptCount;
        operation.lastCompletedAt = new Date().toISOString();
        delete operation.startedAtMs;

        IOCoordinator.snapshot.activeCalls = Math.max(0, IOCoordinator.snapshot.activeCalls - 1);
        IOCoordinator.snapshot.completedCalls += 1;
        IOCoordinator.snapshot.totalDurationMs += durationMs;
        IOCoordinator.snapshot.averageDurationMs =
            IOCoordinator.snapshot.completedCalls === 0
                ? 0
                : IOCoordinator.snapshot.totalDurationMs / IOCoordinator.snapshot.completedCalls;
        IOCoordinator.snapshot.maxDurationMs = Math.max(IOCoordinator.snapshot.maxDurationMs, durationMs);

        if (wasSuccessful) {
            operation.successCount += 1;
            IOCoordinator.snapshot.successCount += 1;
        } else {
            operation.failureCount += 1;
            operation.lastErrorMessage = IOCoordinator.getErrorMessage(error);
            operation.lastErrorAt = new Date().toISOString();
            const status = IOCoordinator.getErrorStatus(error);
            const code = IOCoordinator.getErrorCode(error);
            operation.lastStatus = status;
            operation.lastCode = code;
            IOCoordinator.snapshot.failureCount += 1;
            IOCoordinator.snapshot.lastError = IOCoordinator.buildLastError(operation.name, error);
        }

        IOCoordinator.publish();
    }

    private static recordRetry(operationName: string): void {
        const operation = IOCoordinator.getOrCreateOperation(operationName);
        operation.retryCount += 1;
        IOCoordinator.snapshot.totalRetries += 1;
        IOCoordinator.publish();
    }

    private static recordContextOptimization(
        originalMessages: number,
        optimizedMessages: number,
        originalChars: number,
        optimizedChars: number,
    ): void {
        const context = IOCoordinator.snapshot.contextOptimization;
        const savedChars = Math.max(0, originalChars - optimizedChars);
        const estimatedTokensSaved = Math.max(0, Math.floor(savedChars / 4));

        context.callCount += 1;
        context.originalMessageCount += originalMessages;
        context.optimizedMessageCount += optimizedMessages;
        context.droppedMessageCount += Math.max(0, originalMessages - optimizedMessages);
        context.originalEstimatedChars += originalChars;
        context.optimizedEstimatedChars += optimizedChars;
        context.estimatedTokensSaved += estimatedTokensSaved;
        context.lastAppliedAt = new Date().toISOString();

        IOCoordinator.publish();
    }

    public static setMetricsListener(listener?: (snapshot: IoCoordinatorSnapshot) => void): void {
        IOCoordinator.listener = listener;
        if (listener) {
            listener(IOCoordinator.cloneSnapshot());
        }
    }

    public static getSnapshot(): IoCoordinatorSnapshot {
        return IOCoordinator.cloneSnapshot();
    }

    public static reset(): void {
        IOCoordinator.snapshot = createIoCoordinatorDefaults();
        IOCoordinator.operations.clear();
        IOCoordinator.publish();
    }

    /**
     * Executes an async operation with robust exponential backoff.
     * Best used for LLM API calls and external fetches that may fail due to transient network or backend issues.
     */
    public static async executeWithResilience<T>(
        operationName: string,
        operation: () => Promise<T>,
        options: RetryOptions = {}
    ): Promise<T> {
        const maxRetries = options.maxRetries ?? 5;
        let backoffMs = options.initialBackoffMs ?? 2000;
        const maxBackoffMs = options.maxBackoffMs ?? 60000;
        const backoffFactor = options.backoffFactor ?? 2;

        let attempt = 0;
        const operationState = IOCoordinator.recordStart(operationName);

        const isRetryable = (error: unknown): boolean => {
            // Allow custom validation rule passed via options
            const status = IOCoordinator.getErrorStatus(error);
            if (options.retryableStatusRules && options.retryableStatusRules(status, error)) {
                return true;
            }

            if (status) {
                // HTTP 429 Too Many Requests
                // HTTP 500+ Server Errors
                if (status === 429 || (status >= 500 && status <= 599)) return true;
            }

            const code = IOCoordinator.getErrorCode(error);
            // Network layer errors
            if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNREFUSED') return true;

            const message = IOCoordinator.getErrorMessage(error);
            // Fetch API abort / timeouts
            if (message.includes('fetch failed') || message.includes('Timeout') || message.includes('network error')) return true;

            return false;
        };

        while (attempt <= maxRetries) {
            try {
                const result = await operation();
                IOCoordinator.finalizeOperation(operationState, attempt + 1, true);
                return result;
            } catch (error: unknown) {
                attempt++;
                const canRetry = isRetryable(error);
                const errorMessage = IOCoordinator.getErrorMessage(error);

                if (!canRetry || attempt > maxRetries) {
                    IOCoordinator.finalizeOperation(operationState, attempt, false, error);
                    const finalError = new Error(`[IOCoordinator] ${operationName} failed after ${attempt} attempts: ${errorMessage}`);
                    Object.assign(finalError, { cause: error });
                    throw finalError;
                }

                IOCoordinator.recordRetry(operationName);
                console.warn(`[IOCoordinator] ${operationName} error (attempt ${attempt}/${maxRetries}): ${errorMessage}. Retrying in ${backoffMs}ms...`);
                await new Promise((res) => setTimeout(res, backoffMs));

                backoffMs = Math.min(backoffMs * backoffFactor, maxBackoffMs);
            }
        }

        throw new Error('Unreachable code in IO Coordinator');
    }

    /**
     * Token optimizer: Trims message history payload to fit context windows 
     * or strip redundancy before dispatching to provider.
     */
    public static optimizeContext<MessageType extends { content?: unknown, role: string }>(
        messages: MessageType[],
        maxTokensApproximation: number
    ): MessageType[] {
        // Basic approximate truncation strategy for token efficiency: 
        // Roughly 4 chars per token. If exceeds max, we drop older messages keeping system/first user instruction and latest history.
        let currentLengthAppx = 0;
        const optimized: MessageType[] = [];

        // Always keep system prompt if exists
        if (messages[0]?.role === 'system') {
            optimized.push(messages[0]);
            currentLengthAppx += IOCoordinator.estimateContentLength(messages[0].content);
        }

        // Traverse backward from most recent, keeping as much as we can fit
        const retained: MessageType[] = [];
        for (let i = messages.length - 1; i >= (optimized.length > 0 ? 1 : 0); i--) {
            const msg = messages[i];
            if (currentLengthAppx + IOCoordinator.estimateContentLength(msg.content) > (maxTokensApproximation * 4)) {
                // We hit budget constraint
                break;
            }
            retained.unshift(msg);
            currentLengthAppx += IOCoordinator.estimateContentLength(msg.content);
        }

        const optimizedMessages = [...optimized, ...retained];
        const originalChars = messages.reduce(
            (total, message) => total + IOCoordinator.estimateContentLength(message.content),
            0,
        );
        const optimizedChars = optimizedMessages.reduce(
            (total, message) => total + IOCoordinator.estimateContentLength(message.content),
            0,
        );

        IOCoordinator.recordContextOptimization(
            messages.length,
            optimizedMessages.length,
            originalChars,
            optimizedChars,
        );

        return optimizedMessages;
    }
}
