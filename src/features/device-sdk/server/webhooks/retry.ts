/**
 * Retry schedule (ruled: KB Plans/"Dopl SDK - Webhook Sender" §delivery model). Attempt 1 is
 * immediate; after a failed attempt n the next waits `RETRY_DELAYS_S[n - 1]` (±10% jitter). After
 * attempt {@link WEBHOOK_MAX_ATTEMPTS} fails the delivery is dead-lettered (`failed`); a replay gives
 * it a fresh budget. Total span ≈ 27h.
 */
export const RETRY_DELAYS_S = [5, 5 * 60, 30 * 60, 2 * 3600, 5 * 3600, 10 * 3600, 10 * 3600] as const;
export const WEBHOOK_MAX_ATTEMPTS = RETRY_DELAYS_S.length + 1;
const RETRY_JITTER = 0.1;

/**
 * When to try again after `attemptsDone` failed tries in this run, or `null` = dead-letter.
 * `random` in [0, 1) is injectable for tests.
 */
export function nextAttemptAt(attemptsDone: number, now: Date, random: () => number = Math.random): Date | null {
  if (!Number.isInteger(attemptsDone) || attemptsDone < 1) throw new Error("nextAttemptAt: attemptsDone must be >= 1");
  if (attemptsDone >= WEBHOOK_MAX_ATTEMPTS) return null;
  const base = RETRY_DELAYS_S[attemptsDone - 1] * 1000;
  const jitter = 1 + RETRY_JITTER * (2 * random() - 1);
  return new Date(now.getTime() + Math.round(base * jitter));
}
