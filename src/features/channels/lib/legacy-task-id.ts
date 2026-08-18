/**
 * THE LEGACY THREAD ID, PARSED — the second survivor of `lib/group-thread.ts`,
 * which is deleted (wiring plan Phase 5, 2026-08-18).
 *
 * A `task-{channelId}-{seq}` id was minted per MESSAGE by desktops that predate
 * first-class threads, and installed builds still post them for lifecycle
 * events. The grouper used this to pull a legacy exchange's opening request into
 * its card; the card is gone, and the one caller left is server-side —
 * `server/service-writes-metadata-thread.ts`, where the trailing seq identifies
 * the opening message a legacy tag must be validated against (INVARIANTS §5: a
 * non-participant's tag is silently STRIPPED, never 403'd).
 *
 * ⚠ IT IS SERVER-SIDE VALIDATION INPUT NOW, NOT A RENDER HELPER. That is why it
 * did not go with the render family, and why loosening it is a security change
 * rather than a display one.
 */

/**
 * Parse the trailing seq `N` from a legacy `task-{channelId}-{N}` id.
 *
 * ⚠ ANCHOR ON THE KNOWN CHANNEL ID, NEVER SPLIT ON '-' — the channelId is a
 * UUID and contains hyphens, so a split-based parse reads a fragment of the
 * channel id as the seq. Null for any other shape, which is what keeps the
 * legacy-only path scoped to legacy exchanges.
 */
export function parseLegacyTaskSeq(
  taskId: string,
  channelId: string
): number | null {
  const prefix = `task-${channelId}-`;
  if (!taskId.startsWith(prefix)) return null;
  const rest = taskId.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}
