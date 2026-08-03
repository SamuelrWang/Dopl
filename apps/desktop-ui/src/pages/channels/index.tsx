import { ChannelsViewCore } from "@/features/channels/components/channels-view-core";
import { PageError, PageLoading } from "#/components/page-states";
import { RouterLink } from "#/components/app-shell";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * /:workspaceSegment/channels — the agent-to-agent collaboration surface.
 * Port of `src/app/[workspaceSlug]/(app)/channels/page.tsx`
 * (docs/migration-research/web-pages.md §12).
 *
 * The RSC fetched no data: it resolved the workspace + the caller's membership
 * and handed `ChannelsView` four props. Everything below that — the channel
 * list, transcript, roster, threads, consent inbox, trust rules, agent roster
 * and every mutation in `channels/client/api.ts` — was already client-side over
 * `apiRequest`, which transports over the Electron IPC bridge here unchanged.
 * So this file is only the seam that replaces the two server calls, and the
 * whole channels tree is REUSED by import.
 *
 * `ChannelsViewCore` rather than `ChannelsView`: the web file is the
 * `next/link` binding for the first-run explainer's step cards, and this app
 * passes its own `RouterLink` instead. Nothing else in the tree touched Next.
 *
 * WHAT DEGRADES HERE, AND WHAT DOES NOT (the four realtime subscriptions the
 * web page opens are deliberate no-ops in the bundled SPA —
 * `shared-channel-registry.ts` short-circuits on `window.dopl`, Phase 3 owns
 * the replacement):
 *
 * - **Consent inbox** — unaffected in practice. It fetches on mount and the
 *   page passes `CONSENT_INBOX_POLL_MS` (30 s), so a request raised elsewhere
 *   still lands within 30 s, and a decision made here refetches immediately.
 * - **Message list / channel list / threads** — fetch on mount, then refresh
 *   only on this window's own writes (every mutation awaits its refetch) and
 *   on TanStack focus revalidation. An INBOUND message from a teammate's agent
 *   is stale until one of those fires. This is the one real live-ness loss and
 *   it is Phase 3's to fix, not this port's.
 * - **Roster / presence** — same: initial fetch is real, the "N online" strip
 *   and the online rings go stale between refetches (the 90 s freshness window
 *   is client-side arithmetic over `lastSeenAt`, so a stale roster reads as
 *   offline rather than as falsely online — it fails safe).
 * - **Agent chips** — the roster query fetches on mount; `useEngagementClock`
 *   still schedules its own wake for the 60 min engagement TTL, which never
 *   depended on realtime.
 *
 * NOT WIRED, and not wireable from here: the consent card's desktop-only rows
 * (working folder, permission preset) feature-detect `window.dopl.channels`,
 * which the SPA preload does not expose — see the report accompanying this
 * port. They render nothing, exactly as they do in a plain browser.
 */
export default function ChannelsPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) return <PageLoading label="Loading channels" />;

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
