import type { Role } from "@/features/workspaces/types";

/**
 * A minted, not-yet-claimed CHANNEL LINK, as it appears on the wire.
 *
 * 🔒 **IN `shared/` BECAUSE TWO FEATURES NOW STATE IT** (Wave 3, R-26). The link
 * table is the HOME feature's (`channel_links`, its claim gate and its mint), but
 * an OPEN BOUND link is a STATE OF A CHANNEL and therefore a field of
 * `channels/types.ts › Channel`. §1 forbids `channels → home`, and a second
 * hand-written copy of this shape is exactly the fork this wave is removing — so
 * the type moves DOWN rather than being duplicated or imported sideways.
 *
 * ⚠ **TYPE-ONLY AND CLIENT-SAFE.** The mappers and the DB row shape are
 * `shared/links/dto.ts`, which is `server-only`.
 */
export interface ChannelPendingLink {
  id: string;
  /** Full claim URL (`shared/links/dto.ts › claimUrl`). */
  url: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  /** null = multi-use. */
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  /**
   * What claiming it grants. ⚠ **`?? "guest"` AT EVERY READ** — the DB default,
   * the CHECK's floor, and the fail-safe for a row minted before the column
   * existed (`20260825150000`, F-319).
   */
  grantedRole: Role;
}
