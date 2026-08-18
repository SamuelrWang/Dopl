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
 * REALTIME IS LIVE HERE, over the ui-sync DOORBELL rather than a websocket in
 * this renderer (CSP `connect-src 'none'`). `shared-channel-registry.ts ›
 * subscribeSharedWorkspaceTables` routes to `› subscribeViaBridge` whenever the
 * bridge exposes `onSyncEvent` + `syncWatch`, which `renderer/app-preload.js`
 * does (pinned by `test/preload-parity.test.mjs › APP_OPS`); main watches
 * postgres_changes and forwards coalesced `{workspaceId, table}` events. All
 * five tables these hooks watch — `channels`, `channel_members`,
 * `channel_messages`, `channel_consent_requests`, `agent_presence` — are in
 * `main/ui-sync.js › SYNC_TABLES`, so `useChannelsRealtime` /
 * `useConsentRealtime` / `usePresenceRealtime` all deliver.
 *
 * ⚠ This docblock said the opposite until 2026-08-18 and was wrong from ~26
 * minutes after it was written — see F-199. Do not restate liveness from
 * memory; the bridge path is a capability check, and `SYNC_TABLES` is the list.
 *
 * - **An OLDER main with no sync surface** is the one dark case: the registry
 *   returns a no-op unsubscribe rather than opening a socket this renderer
 *   cannot reach, and the page falls back to mount-fetch plus this window's own
 *   writes plus TanStack focus revalidation.
 * - **Consent inbox** — `CONSENT_INBOX_POLL_MS` (30 s) is passed as the same
 *   BACKSTOP the web page passes, not as the delivery path.
 * - **Roster / presence** — fails safe in either direction: the 90 s freshness
 *   window is client-side arithmetic over `lastSeenAt`, so a stale roster reads
 *   offline, never falsely online.
 *
 * The consent card's desktop-only rows (working folder, permission preset) ARE
 * wired: `app-preload.js` exposes `window.dopl.channels` with `getFolderLabel`,
 * `chooseFolder`, `clearFolder`, `getPermissionPreset` and `setPermissionPreset`,
 * and `preload-parity.test.mjs` names `channels.chooseFolder` as "the consent
 * card's folder row" in its already-shipped-a-silent-bug list (F-200).
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
