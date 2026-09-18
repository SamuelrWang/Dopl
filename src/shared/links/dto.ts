import "server-only";
import type { Role } from "@/features/workspaces/types";
import type { ChannelPendingLink } from "./types";

/**
 * `snake_case` → `camelCase` for a CHANNEL LINK, and the claim gate's own
 * predicate. No row shape leaves here.
 *
 * 🔒 **MOVED OUT OF `home/server/dto.ts` IN WAVE 3 (R-26).** An open BOUND link is
 * a field of `Channel` now (`linkOut`), so the channels projection has to read
 * it — and §1 forbids `channels → home`. `home/server/dto.ts` RE-EXPORTS every
 * name below, so no home caller moved.
 *
 * ⚠ **ONE DEFINITION OF "still claimable", READ BY THE GATE AND BY THE CHIP.** A
 * row saying "invite out" over a link that 410s is exactly what {@link isClaimable}
 * exists to prevent; a second spelling anywhere re-opens it.
 */

export const CHANNEL_LINK_COLS =
  "id, creator_user_id, workspace_id, token, label, expires_at, max_uses, use_count, revoked_at, created_at, granted_role";

export interface ChannelLinkRow {
  id: string;
  creator_user_id: string;
  /**
   * ⚠ THE INVERSION, in one column (migration 20260824120000). `null` = a legacy
   * UNBOUND link: claiming it MINTS a container. Non-null = a BOUND link:
   * claiming it JOINS that container. Both branches are live — open unbound
   * tokens exist in the wild.
   */
  workspace_id: string | null;
  token: string;
  label: string | null;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
  /**
   * The role a BOUND claim confers on the claimer (migration
   * 20260825150000_channel_link_granted_role; closes F-319). DB CHECK pins it to
   * `('guest','viewer','member')` — `admin`/`owner`-via-link is unrepresentable —
   * and the column DEFAULTs `'guest'`, so an open link with no explicit grant,
   * and every link minted before this column existed, confers the FLOOR. Typed
   * `Role` (the superset) because the CHECK is the real ceiling and the value
   * flows straight into `insertContainerMember`'s `role: Role`. ⚠ The LEGACY
   * UNBOUND claim never reads this — it keeps its hardcoded `admin` (plan §4.3).
   */
  granted_role: Role;
}

/**
 * Claim URL for a token. ⚠ Built from `NEXT_PUBLIC_APP_URL` — the same base
 * every other SERVER-built user-facing URL uses (`billing/server/stripe.ts`,
 * `billing/server/entitlements.ts`). `shared/lib/app-origin.ts › getAppOrigin`
 * is the client twin and answers `""` here.
 */
export function claimUrl(token: string): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com"
  ).replace(/\/+$/, "");
  return `${base}/link/${token}`;
}

/**
 * The three ways a link can be over. ⚠ ONE definition, read by the claim gate
 * AND by the public claim page — a page that says "still valid" over a gate
 * that says 410 is the failure this shares a function to prevent.
 */
export function linkState(
  row: ChannelLinkRow,
  now: number = Date.now()
): { revoked: boolean; expired: boolean; exhausted: boolean } {
  return {
    revoked: row.revoked_at !== null,
    expired: row.expires_at !== null && Date.parse(row.expires_at) <= now,
    exhausted: row.max_uses !== null && row.use_count >= row.max_uses,
  };
}

export function isClaimable(row: ChannelLinkRow, now?: number): boolean {
  const state = linkState(row, now);
  return !state.revoked && !state.expired && !state.exhausted;
}

export function mapLinkRow(row: ChannelLinkRow): ChannelPendingLink {
  return {
    id: row.id,
    url: claimUrl(row.token),
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    useCount: row.use_count,
    revokedAt: row.revoked_at,
    // ⚠ PROJECTED SINCE 2026-08-26. It was in `ChannelLinkRow` from M2 and
    // stopped at this function, so no caller could compare an OPEN link's grant
    // against the one the operator just picked — which is how the role picker
    // silently no-op'd on the reuse branch (`service-writes.ts ›
    // mintContainerLink`). A column read but not mapped is a column nothing can
    // act on.
    grantedRole: row.granted_role,
  };
}
