export function createIdempotencyKey(scope: string): string {
  const random =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${scope}:${random}`;
}

export function exponentialRetryDelay(attempt: number): number {
  const boundedAttempt = Math.max(0, Math.min(attempt, 6));
  return Math.min(60_000, 1_000 * 2 ** boundedAttempt);
}
