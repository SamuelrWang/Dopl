/**
 * Domain types for the SDK's HOME methods — `getHomeChannels` and
 * `createHomeChannel`, both of which address `/api/channels?scope=account`.
 *
 * 🔒 **THE HAND-WRITTEN `HomeChannel` MIRROR IS RETIRED (Wave 3, Samuel's ruling
 * R-26 (b), 2026-09-17: *one channel projection*).** It mirrored
 * `src/features/home/types.ts › HomeChannel`, a 15-field SECOND answer to *"which
 * channels am I in and what is their state"*, off a second route, into a second
 * cache. The server deleted all three. **The row is `channel-types.ts › Channel`
 * now — the mirror this package already had** — so `getHomeChannels` and
 * `listChannels` answer the same shape, which is the ruling one layer out.
 * `HomePeer` went with it (nothing in this package reads a roster) and
 * `HomePendingLink` is {@link ChannelPendingLink}, the server's own name for it
 * (`src/shared/links/types.ts`).
 *
 * ⚠ **HAND-SYNCED, AND NO DRIFT GATE COVERS IT** — like `account-types.ts` and
 * `agent-template-types.ts`; both halves move in ONE change. **So it mirrors what
 * a consumer READS, never the whole server type.** `Channel` is already the
 * narrower of the two, and the four other fields R-26 put on the row —
 * `myWorkspaceRole`, `peers`, `mentionCount`, `linkOut` — are deliberately NOT
 * mirrored. **Their absence here means "no SDK caller reads this yet", never "the
 * server does not send it"**; add one when a caller needs it, in one change with
 * the server half. `Channel.container` IS mirrored, and the reason is below.
 *
 * ⚠ **THE METHOD NAMES SAY "HOME" AND THE SCOPE NO LONGER DOES.**
 * `scope=account` answers EVERY channel the caller is in, in EVERY container of
 * EVERY kind — not the `kind='link'` rooms alone. That is why
 * `types.ts › ChannelContainer` is mirrored: it is the only field on the row that
 * can tell a home channel from a workspace channel, and the filter is the
 * POSITIVE `container?.kind === "link"` (§4A, F-564). The names are kept because
 * `client-surface.test.ts` pins the published method list by name and renaming is
 * a separate argument from repointing.
 *
 * ⚠ **THE OLD HEADER CALLED THIS TYPE "THE CONTAINER DOOR" AND THAT CLAIM IS
 * DEAD.** It was true while `listWorkspaces` filtered containers out of its
 * listing through `isStandardWorkspace`, which made this list the only way to
 * enumerate them. **B10 stopped that filtering**: `GET /api/workspaces` answers
 * every container the caller actively belongs to, of every kind, and
 * `packages/mcp-server/src/workspace-directory.ts › getWorkspaceList` reads
 * exactly that and nothing else. **The door is `listWorkspaces()`**, which is why
 * retiring the row type costs that package nothing.
 */

import type { Channel } from "./channel-types.js";
import type { WorkspaceRole } from "./types.js";

/**
 * A minted, not-yet-claimed CHANNEL LINK, as it appears on the wire. Mirrors
 * `src/shared/links/types.ts › ChannelPendingLink` under the server's own name
 * (it was `HomePendingLink` here).
 *
 * 🚫 **READ-ONLY, AND THE OMISSION IS THE DESIGN.** Minting one is
 * `POST /api/home/links`, which is `sessionOnly` because it mints a credential
 * that reaches a PERSON; the revoke and the claim are `sessionOnly` for the same
 * reason. No SDK method binds any of them — the same omission
 * `deleteAgentTemplate` makes. See `home.ts`.
 */
export interface ChannelPendingLink {
  id: string;
  /** Full claim URL. */
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
   * existed (`20260825150000`, F-319). ⚠ OPTIONAL here where the server type is
   * not, for that same reason: a cached payload can predate the column.
   */
  grantedRole?: WorkspaceRole;
}

/**
 * Payload of `GET /api/channels?scope=account`.
 *
 * ⚠ **`pendingLinks` IS THE CALLER'S LEGACY UNBOUND LINKS ONLY.** A link BOUND to
 * a channel rides that channel as its `linkOut` server-side, and a link is never
 * in both — two lists would show one invitation twice. ⚠ It is OPTIONAL because
 * `scope=container` answers with the key ABSENT rather than `[]` (§9's
 * `channelGrants` precedent: an absent param yields an absent key, where `[]`
 * would assert "asked, none open").
 */
export interface HomeChannelsPayload {
  channels: Channel[];
  pendingLinks?: ChannelPendingLink[];
  /**
   * ⚠ **READ IT** (INVARIANTS §9). The account list is CAPPED server-side, and a
   * clipped page rendered as the whole of what the caller is in is the bug this
   * field exists to prevent. ⚠ Absent under `scope=container` and on a server
   * predating the field; spell `?? false` inline.
   */
  truncated?: boolean;
}

/**
 * Payload of `POST /api/channels?scope=account` — "New channel": a solo
 * `kind='link'` container plus one private channel inside it.
 *
 * ⚠ **THE ROW IS `Channel`, THE ONE PROJECTION**, so a freshly-minted channel and
 * one read off the list are the same shape — the mint can patch a list cache
 * instead of invalidating it.
 */
export interface HomeChannelCreateResult {
  channel: Channel;
}
