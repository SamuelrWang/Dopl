const BACKOFF_BASE_MS = 200;
const BACKOFF_CAP_MS = 5_000;
const RETRY_AFTER_CAP_MS = 60_000;

export const RETRIABLE_STATUS = new Set([429, 502, 503, 504]);
export const IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);
export const DEFAULT_GET_RETRIES = 3;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computeBackoff(attempt: number): number {
  const exp = BACKOFF_BASE_MS * 2 ** attempt;
  const jitter = 0.5 + Math.random();
  return Math.min(Math.round(exp * jitter), BACKOFF_CAP_MS);
}

export function parseRetryAfter(
  value: string | null,
  now: number = Date.now()
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - now), RETRY_AFTER_CAP_MS);
}

export function waitForStatus(res: Response, attempt: number): number {
  if (res.status === 429) {
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    if (retryAfter !== null) return retryAfter;
  }
  return computeBackoff(attempt);
}
