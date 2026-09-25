/**
 * Types for the SDK's home methods (`getHomeChannels`, `createHomeChannel`), both on
 * `/api/channels?scope=account`. The row is `channel-types.ts › Channel`; hand-synced with no drift
 * gate, mirroring only what a consumer reads (an unmirrored field is unread, not unsent). The scope
 * answers every container kind: tell a home channel by `container?.kind === "link"` (F-564).
 */

import type { Channel } from "./channel-types.js";
import type { WorkspaceRole } from "./types.js";

/** `POST /api/channels?scope=account`'s body; `topic` is the product's "description". */
export interface HomeChannelCreateInput {
  name: string;
  topic?: string;
}

/** A minted, unclaimed channel link (server: `src/shared/links/types.ts › ChannelPendingLink`).
 *  Read-only here: mint/revoke/claim are `sessionOnly` (they reach a person), so nothing binds them. */
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
  /** What claiming grants; read `?? "guest"` (F-319) — optional because a cached payload can predate it. */
  grantedRole?: WorkspaceRole;
}

/** `GET /api/channels?scope=account`. `pendingLinks` = the caller's unbound links only (a bound one
 *  rides its channel); absent under `scope=container` (absent param ⇒ absent key, not `[]`). */
export interface HomeChannelsPayload {
  channels: Channel[];
  pendingLinks?: ChannelPendingLink[];
  /** The account list is capped server-side — a clipped page is not the whole (INVARIANTS §9).
   *  Absent under `scope=container` and on an older server; read `?? false`. */
  truncated?: boolean;
}

/** `POST /api/channels?scope=account`: a solo `link` container plus one private channel. */
export interface HomeChannelCreateResult {
  channel: Channel;
}
