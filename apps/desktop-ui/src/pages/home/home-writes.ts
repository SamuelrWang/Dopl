import { useApiMutation } from "@/shared/hooks/use-api-mutation";
import { apiPathKey } from "@/shared/api/query-keys";
import type {
  HomeChannelCreateResult,
  HomeLinkMintResult,
} from "@/features/home/types";
import type {
  HomeChannelCreateInput,
  HomeLinkMintBody,
} from "@/features/home/schema";
import { HOME_CHANNELS_PATH, HOME_LINKS_PATH } from "./home-rows";

/**
 * `POST /api/home/links`, as the ROUTE'S OWN schema types it. ⚠ Inferred, not
 * restated: the hand-written copy this replaces existed only because the schema
 * sat under `server/`, which the renderer's ESLint fence blocks — it has moved
 * to `features/home/schema.ts` and there is nothing left to fence.
 * ⚠ It carries a REQUIRED `workspaceId` since 2026-08-24: a link is bound to
 * the channel it adds a person to.
 */
export type HomeLinkDraft = HomeLinkMintBody;

/** Both reads a link write can move. The channels payload carries both the
 *  legacy pending-link rows and each channel's own `linkOut`; `/api/home/links`
 *  is the same legacy rows for any other reader, so a write settles both rather
 *  than guessing which is mounted. */
const LINK_READS = [
  apiPathKey(HOME_CHANNELS_PATH),
  apiPathKey(HOME_LINKS_PATH),
];

/**
 * "New channel" — `POST /api/home/channels`. The one write the account surface
 * starts from: a solo container plus the private channel inside it.
 *
 * ⚠ IT INVALIDATES RATHER THAN RECONCILING, which is the exception this hook's
 * docblock allows and not an oversight. The answer carries the created channel,
 * but the list is SERVER-ORDERED (newest activity first, both kinds folded
 * together) and splicing a row into that order client-side is a second copy of
 * a sort the server already owns — a refetch of one small payload is cheaper
 * than a rule that can disagree.
 *
 * ⚠ `onCreated` GETS THE WORKSPACE ID, not the channel: what the caller does
 * with it is select the new row, and `home-rows.ts › channelRowId` keys rows by
 * exactly that. The row itself arrives with the refetch.
 */
export function useCreateHomeChannel(onCreated: (workspaceId: string) => void) {
  return useApiMutation<HomeChannelCreateInput, HomeChannelCreateResult>({
    request: (draft) => ({ path: HOME_CHANNELS_PATH, body: draft }),
    invalidate: () => [apiPathKey(HOME_CHANNELS_PATH)],
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
