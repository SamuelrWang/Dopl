/**
 * Shared utilities for the ingestion pipeline:
 * - fetchWithTimeout: fetch with configurable timeout
 * - retryWithBackoff: retry with exponential backoff
 * - downloadImageAsBase64: download + validate image size
 * - truncateContent: enforce content budget before Claude calls
 */

import { MAX_IMAGE_SIZE_BYTES } from "@/lib/config";

const DEFAULT_FETCH_TIMEOUT_MS = 30_000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000; // 1 second

/**
 * Fetch with a timeout. Throws if the request takes longer than `timeoutMs`.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Retry a function with exponential backoff.
 * Retries on transient errors (network failures, 5xx, 429).
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

      // Only retry on transient errors
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
  const msg = error.message.toLowerCase();

  // Check for HTTP status code in error object (Anthropic/OpenAI SDKs set .status)
  const status = (error as unknown as Record<string, unknown>).status;
  if (typeof status === "number" && (status === 429 || status === 529 || status === 502 || status === 503)) {
    return true;
  }

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download an image URL as base64, with size and timeout limits.
 * Returns null if the image is too large, wrong type, or fails to download.
 */
export async function downloadImageAsBase64(
  imageUrl: string,
  options: { maxSizeBytes?: number; timeoutMs?: number } = {}
): Promise<{ base64: string; mimeType: string } | null> {
  const {
    maxSizeBytes = MAX_IMAGE_SIZE_BYTES,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  } = options;

  try {
    // HEAD request first to check size without downloading
    const headResponse = await fetchWithTimeout(imageUrl, {
      method: "HEAD",
      timeoutMs,
    });

    const contentLength = headResponse.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
      console.warn(
        `[image] Skipping ${imageUrl}: size ${contentLength} exceeds ${maxSizeBytes} limit`
      );
      return null;
    }

    const contentType = headResponse.headers.get("content-type") || "";
    if (contentType && !contentType.startsWith("image/")) {
      console.warn(
        `[image] Skipping ${imageUrl}: content-type "${contentType}" is not an image`
      );
      return null;
    }

    // Download the image
    const response = await fetchWithTimeout(imageUrl, { timeoutMs });
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();

    // Double-check actual size
    if (buffer.byteLength > maxSizeBytes) {
      console.warn(
        `[image] Skipping ${imageUrl}: downloaded size ${buffer.byteLength} exceeds limit`
      );
      return null;
    }

    const mimeType =
      response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const base64 = Buffer.from(buffer).toString("base64");

    return { base64: `data:${mimeType};base64,${base64}`, mimeType };
  } catch (error) {
    console.error(`[image] Failed to download ${imageUrl}:`, error);
    return null;
  }
}

/**
 * Truncate content to a character budget.
 * If content exceeds the limit, it's truncated with a note.
 */
export function truncateContent(
  content: string,
  maxChars: number = 100_000
): string {
  if (content.length <= maxChars) return content;

  const truncated = content.slice(0, maxChars);
  return `${truncated}\n\n[Content truncated: original was ${content.length} characters, limited to ${maxChars}]`;
}
