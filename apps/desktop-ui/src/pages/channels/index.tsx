import { useParams, useSearchParams } from "react-router";
import { ChannelsV2Core } from "@/features/channels/components/channels-v2/channels-v2-core";
import { PageError } from "#/components/page-states";
import { RouterLink } from "#/components/app-shell";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";
import { ChannelsSkeleton } from "./channels-skeleton";

/**
 * /:workspaceSegment/channels — and `/channels/:channelId`, the SAME page with
 * a channel named — the three-column channels surface, on real reads.
 *
 * ⚠ THIS IS THE CUTOVER (wiring plan Phase 12, 2026-08-18). Until then there
 * were two pages: this seam over the two-pane `ChannelsViewCore`, and a
 * temporary `channels-v2` route over the ported surface. The v2 route, its
 * folder, its nav row and its deep-link entry are GONE and the ported surface
 * took this path; `components/channels-view-core.tsx`, `channel-pane.tsx`,
 * `channels-list-pane.tsx`, `rooms-sidebar.tsx`, `channel-transcript.tsx` and
 * `message-composer.tsx` were deleted in the same change. **`ChannelsV2Core`
 * keeps its name deliberately** — it is a component family under
 * `components/channels-v2/`, not a route string, and renaming the whole
 * directory buys a word (wiring plan Phase 12, § the string sweep). ⚠ THE FILE
 * COUNT IS A MEASUREMENT, NOT A FACT ABOUT THIS PAGE — run it, never quote it
 * (this docblock carried a stale "35 files" for two days):
 * `ls src/features/channels/components/channels-v2 | wc -l`.
 *
 * ⚠ THE `:channelId` ROW IS THE DESKTOP NOTIFICATION'S LANDING SPOT (wiring
 * plan Phase 9). Main focuses the window and pushes
 * `/{segment}/channels/{channelId}` over the navigate bridge
 * (`main/shell-mode.js › CHANNELS_PAGE`); this file is the ONLY place that
 * reads the param, because `ChannelsV2Core` is Next-free AND router-free by
 * construction (it is imported by the web tree too). The param is an INITIAL
 * selection handed down as a plain prop — never a router dependency inside the
 * shared tree.
 *
 * ⚠ `?thread=` IS A SELECTION, NOT A ROUTE (wiring plan Phase 10, 2026-08-18):
 * a thread is not a page, it is which transcript this page has open, so it
 * rides the SAME `:channelId` row the cutover built, adds no `WORKSPACE_PAGES`
 * entry, and leaves the deep-link hand copy in
 * `main/deep-link-target.js › WORKSPACE_PAGES` and its drift test untouched.
 * Read here for the same reason `:channelId` is: `ChannelsV2Core` is router-free
 * by construction, so the param becomes a plain prop.
 *   ⚠ **THE POP-OUT WINDOW NO LONGER LANDS HERE (2026-08-19).** It opened a
 *   second window on THIS page until then, which meant a window opened to read
 *   one thread arrived carrying the sidebar, the tree and the info panel. It has
 *   a thread-ONLY route now — `pages/thread-window/index.tsx`, outside the app
 *   shell — and `main/popout-window.js › threadRoute` builds that instead.
 *
 * ⚠ ONLY A SEAM. The whole tree is REUSED by import from
 * `@/features/channels/components/channels-v2/`, already client-side over
 * `apiRequest`, which transports over the Electron IPC bridge unchanged. This
 * file resolves the workspace and hands over; it owns no state and no fetching.
 * `RouterLink` is passed for the SAME single consumer it always had — the
 * first-run explainer's step cards, which the cutover rehomed onto the ported
 * surface's no-channels branch.
 *
 * REALTIME IS LIVE HERE, over the ui-sync DOORBELL rather than a websocket in
 * this renderer (CSP `connect-src 'none'`) — see INVARIANTS §7 for the
 * capability check and the table list. The core registers `useChannelsRealtime`
 * + `usePresenceRealtime` through the refetch coordinator, which §7 requires of
 * any live surface. ⚠ Three docblocks claimed the opposite for fifteen days
 * (F-199, F-200); do not restate liveness from memory.
 */
export default function ChannelsPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();
  // Absent on the index row, which is the "no channel named" case the core
  // already answers with its own first-row fallback.
  const { channelId } = useParams<{ channelId: string }>();
  // Absent on every route but a pop-out's landing; the core treats an unknown id
  // as no selection, so a stale link cannot strand the pane.
  const [search] = useSearchParams();
  const threadId = search.get("thread");

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) {
    // ⚠ THE SURFACE'S OWN TWO COLUMNS — a 260px nav tree over a transcript with
    // a card composer — not the generic two-pane list ghost, whose 372px list
    // of avatar rows and 760px document column belong to no page here.
    return <ChannelsSkeleton label="Loading channels" />;
  }

  return (
    <ChannelsV2Core
      workspaceId={access.workspaceId}
      workspaceSlug={access.workspaceSlug}
      currentUserId={access.currentUserId}
      role={access.role}
      Link={RouterLink}
      initialChannelId={channelId ?? null}
      initialThreadId={threadId}
    />
  );
}
