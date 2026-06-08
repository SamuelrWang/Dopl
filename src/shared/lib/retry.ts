import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const TRANSIENT_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000; // 1 second

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retry an async operation with exponential backoff, but only for
 * transient errors (5xx / 429 / network blips). Non-transient errors
 * fail fast.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; label?: string } = {}
): Promise<T> {
  const { maxAttempts = MAX_RETRY_ATTEMPTS, label = "operation" } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts) break;
      if (!isTransientError(lastError)) break;

      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[retry] ${label} attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. Retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

function isTransientError(error: Error): boolean {
  if (error instanceof OpenAI.APIError && typeof error.status === "number") {
    if (TRANSIENT_HTTP_STATUSES.has(error.status)) return true;
  }
  if (error instanceof Anthropic.APIError && typeof error.status === "number") {
    if (TRANSIENT_HTTP_STATUSES.has(error.status)) return true;
  }

  const status = (error as unknown as Record<string, unknown>).status;
  if (typeof status === "number" && TRANSIENT_HTTP_STATUSES.has(status)) {
    return true;
  }

  const msg = error.message.toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("429") ||
    msg.includes("529") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded")
  );
}
