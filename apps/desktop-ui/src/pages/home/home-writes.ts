import { useApiMutation } from "@/shared/hooks/use-api-mutation";
import { apiPathKey } from "@/shared/api/query-keys";
import type { HomeLinkMintResult } from "@/features/home/types";
import type { HomeLinkMintBody } from "@/features/home/schema";
import { HOME_LINKS_PATH, HOME_RELATIONSHIPS_PATH } from "./home-rows";

/**
 * `POST /api/home/links`, as the ROUTE'S OWN schema types it. ⚠ Inferred, not
 * restated: the hand-written copy this replaces existed only because the schema
 * sat under `server/`, which the renderer's ESLint fence blocks — it has moved
 * to `features/home/schema.ts` and there is nothing left to fence.
 * `z.input`, so an omitted `maxUses` still takes the server's single-use default.
 */
export type HomeLinkDraft = HomeLinkMintBody;

/** Both reads a link write can move. The relationships payload carries the
 *  pending links the page renders; `/api/home/links` is the same rows for any
 *  other reader, so a write settles both rather than guessing which is mounted. */
const LINK_READS = [
  apiPathKey(HOME_RELATIONSHIPS_PATH),
  apiPathKey(HOME_LINKS_PATH),
];

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
