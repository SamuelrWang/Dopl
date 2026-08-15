import { ChannelsViewCore } from "@/features/channels/components/channels-view-core";
import { PageError, PageLoading } from "#/components/page-states";
import { RouterLink } from "#/components/app-shell";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * /:workspaceSegment/channels — agent-to-agent collaboration surface. Only a
 * seam: the whole channels tree is REUSED by import, already client-side over
 * `apiRequest`, which transports over the Electron IPC bridge unchanged.
 *
 * `ChannelsViewCore`, not `ChannelsView`: the latter is the `next/link` binding
 * for the first-run explainer's step cards; pass `RouterLink` instead.
 *
 * ⚠ REALTIME IS OFF HERE. `useChannelsRealtime` / `useConsentRealtime` /
 * `usePresenceRealtime` are no-ops in the bundled SPA —
 * `shared-channel-registry.ts` short-circuits on `window.dopl`. Consequences:
 *
 * - **Consent inbox** — fine: page passes `CONSENT_INBOX_POLL_MS` (30 s), and a
 *   decision made here refetches immediately.
 * - **Message list / channel list / threads** — fetch on mount, then refresh
 *   only on this window's own writes and TanStack focus revalidation. An
 *   INBOUND message from a teammate's agent stays stale until one fires. This
 *   is the one real liveness loss.
 * - **Roster / presence** — "N online" strip and rings go stale between
 *   refetches. Fails safe: the 90 s freshness window is client-side arithmetic
 *   over `lastSeenAt`, so a stale roster reads offline, not falsely online.
 *
 * NOT WIRED: consent card's desktop-only rows (working folder, permission
 * preset) feature-detect `window.dopl.channels`, which the SPA preload does not
 * expose. They render nothing, as in a plain browser.
 */
export default function ChannelsPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) return <PageLoading label="Loading channels" variant="two-pane" />;

  return (
    <ChannelsViewCore
      workspaceId={access.workspaceId}
      workspaceSlug={access.workspaceSlug}
      currentUserId={access.currentUserId}
      role={access.role}
      Link={RouterLink}
    />
  );
}
