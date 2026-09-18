import { useApiMutation } from "@/shared/hooks/use-api-mutation";
import { apiPathKey } from "@/shared/api/query-keys";
import {
  channelKeys,
  channelsPath,
} from "@/features/channels/client/query-keys";
import type {
  HomeChannelCreateResult,
  HomeLinkMintResult,
} from "@/features/home/types";
import type {
  HomeChannelCreateInput,
  HomeLinkMintBody,
} from "@/features/home/schema";
import { memberPath } from "@/features/members/client/query-keys";
import { HOME_LINKS_PATH } from "./home-rows";

/**
 * `POST /api/home/links`, as the ROUTE'S OWN schema types it. ⚠ Inferred, not
 * restated: the hand-written copy this replaces existed only because the schema
 * sat under `server/`, which the renderer's ESLint fence blocks — it has moved
 * to `features/home/schema.ts` and there is nothing left to fence.
 * ⚠ It carries a REQUIRED `workspaceId` since 2026-08-24: a link is bound to
 * the channel it adds a person to.
 */
export type HomeLinkDraft = HomeLinkMintBody;

/** Both reads a link write can move. The channel list carries both the legacy
 *  pending-link rows and each channel's own `linkOut`; `/api/home/links` is the
 *  same legacy rows for any other reader, so a write settles both rather than
 *  guessing which is mounted.
 *  ⚠ `channelKeys.list().all` IS THE PREFIX, so one entry reaches BOTH scopes —
 *  a minted BOUND link is a state of a channel the workspace list draws too. */
const LINK_READS = [channelKeys.list().all, apiPathKey(HOME_LINKS_PATH)];

/**
 * "New channel" — `POST /api/channels?scope=account` (R-26 (b); it was
 * `POST /api/home/channels`). The one write the account surface starts from: a
 * solo container plus the private channel inside it.
 *
 * ⚠ IT INVALIDATES RATHER THAN RECONCILING, which is the exception this hook's
 * docblock allows and not an oversight. The answer carries the created channel,
 * but the list is SERVER-ORDERED (newest activity first, both kinds folded
 * together) and splicing a row into that order client-side is a second copy of
 * a sort the server already owns — a refetch of one small payload is cheaper
 * than a rule that can disagree.
 *
 * ⚠ THE DRAFT IS INFERRED from `HomeChannelCreateSchema`, `topic` included —
 * the field the UI calls "Description" (ruling, Samuel, 2026-09-15).
 *
 * ⚠ `onCreated` GETS THE WORKSPACE ID, not the channel: what the caller does
 * with it is select the new row, and `home-rows.ts › channelRowId` keys rows by
 * exactly that. The row itself arrives with the refetch.
 */
export function useCreateHomeChannel(onCreated: (workspaceId: string) => void) {
  return useApiMutation<HomeChannelCreateInput, HomeChannelCreateResult>({
    // ⚠ **THE SCOPE IS WHAT PICKS THE HANDLER**, before auth and before the body
    // is parsed (`app/api/channels/route.ts › dispatch`) — omitting it would POST
    // a home-channel draft at the CONTAINER create, which 400s on a missing
    // workspace rather than minting one.
    request: (draft) => ({
      path: channelsPath(),
      body: draft,
      query: { scope: "account" },
    }),
    invalidate: () => [channelKeys.list().all],
    onSuccess: (result) => onCreated(result.channel.workspaceId),
  });
}

/** `onMinted` receives the full claim URL — the ONE fact only the answer holds
 *  (the raw token is never a field of its own, server-side or here). */
export function useMintHomeLink(onMinted: (url: string) => void) {
  return useApiMutation<HomeLinkDraft, HomeLinkMintResult>({
    request: (draft) => ({ path: HOME_LINKS_PATH, body: draft }),
    invalidate: () => LINK_READS,
    onSuccess: (result) => onMinted(result.link.url),
  });
}

/** DELETE is idempotent and 204s — nothing to reconcile, so the list refetches. */
export function useRevokeHomeLink() {
  return useApiMutation<string, void>({
    request: (linkId) => ({
      path: `${HOME_LINKS_PATH}/${encodeURIComponent(linkId)}`,
      method: "DELETE",
    }),
    invalidate: () => LINK_READS,
  });
}

/**
 * REMOVE A PERSON FROM THIS CONTAINER, or LEAVE it — one write, because
 * departure IS removal (Samuel's ruling R-09, 2026-09-17; INVARIANTS §4A).
 * `DELETE /api/workspaces/{segment}/members/{userId}`, the SAME endpoint the
 * members console uses; the route reads self as a leave.
 *
 * ⚠ THE CHANNELS LIST IS INVALIDATED BECAUSE LEAVING TAKES THE ROW OFF IT — the
 * container is no longer the caller's. A removal moves nothing on that payload
 * and pays one small refetch for not having to know which of the two happened.
 * ⚠ THE ROSTER IS THE CALLER'S TO SETTLE (`onDone`): it belongs to the channel
 * surface's own read, and this hook must not mint a second one (§7).
 */
export function useRemoveContainerMember(
  workspaceSegment: string,
  onDone: () => void
) {
  return useApiMutation<string, void>({
    request: (userId) => ({
      path: memberPath(workspaceSegment, userId),
      method: "DELETE",
    }),
    invalidate: () => [channelKeys.list().all],
    onSuccess: onDone,
  });
}

/** Windows the New-link popover offers, as milliseconds from now. */
export const LINK_EXPIRY_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  never: null,
} as const;

export type LinkExpiryKey = keyof typeof LINK_EXPIRY_MS;

export function expiresAtFrom(key: LinkExpiryKey, now = Date.now()): string | null {
  const ms = LINK_EXPIRY_MS[key];
  return ms === null ? null : new Date(now + ms).toISOString();
}
