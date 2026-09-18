/**
 * Token counts at caption size — ONE declaration (2026-09-17).
 *
 * ⚠ IT WAS TWO, AND THEY ROUNDED DIFFERENTLY: `channels/components/agent-metrics.ts`
 * rounded to nearest with no sub-1000 arm, so `400` read "0k" and `84_500` read
 * "85k"; `overview/token-spend-strip.tsx` floored. The FLOOR is the load-bearing
 * one and this file keeps it — the underlying figure is already a floor (the
 * desktop quantizes to 10k buckets and an ended run's last stretch is never
 * pushed), so rounding up turns an under-count into an over-claim beside a strip
 * whose own caption says "at least this many".
 *
 * ⚠ In `src/shared/` because `src/features/channels/**` cannot import `apps/**`.
 * Pure string builder, like its sibling `format-bytes.ts`.
 */

/**
 * `400` → `"400"`, `84_500` → `"84k"`, `1_250_000` → `"1.2M"`.
 *
 * Never rounds up. Below 1000 the integer is printed whole: an agent that has
 * spent 400 tokens has not spent "0k".
 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1_000_000) return `${Math.floor(tokens / 100_000) / 10}M`;
  if (tokens >= 1_000) return `${Math.floor(tokens / 1_000)}k`;
  return String(Math.floor(tokens));
}
