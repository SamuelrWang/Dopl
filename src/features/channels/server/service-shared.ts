import "server-only";
import { meetsMinRole, type Role, type WorkspaceKind } from "@/features/workspaces/types";
import { narrowAppVersion } from "@/shared/auth/app-version-header";
import { narrowRuntime, type DoplRuntime } from "@/shared/auth/runtime-header";
import { narrowSessionId } from "@/shared/auth/session-header";
import { narrowClientInfo, type McpClientInfo } from "@/shared/auth/mcp-client-info";
import { isUuid } from "@/shared/lib/id/uuid";
import { ChannelForbiddenError, ChannelNotFoundError } from "./errors";
import {
  mapMessageRow,
  type ChannelMemberRow,
  type ChannelMessageRow,
  type ChannelRow,
  type ProfileRef,
} from "./dto";
import type { ChannelMessage } from "../types";
import { authorAgentIdOf } from "../lib/agent-post-stamp";
import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import * as repoAgentFacets from "./repository-agent-facets";
import type { MessageSourceStamp } from "./message-source-stamp";

/**
 * Shared internals for the channels service: `ChannelContext` construction plus the cross-cutting
 * resolvers and visibility / management gates the per-domain service modules use.
 */

export interface ChannelContext {
  workspaceId: string;
  userId: string;
  source: "user" | "agent";
  /** Caller's workspace role; null when the auth layer didn't resolve one. */
  role: Role | null;
  /** The resolver's `workspaces.kind` read; absent = not the Home space (the DB trigger is the backstop). */
  workspaceKind?: WorkspaceKind;
  /** Container a locked credential is fenced to (`mcp_tokens.container_id`), `null` when unfenced.
   *  A fence, never a request field (`service-account.ts` applies it as the B1 ceiling). */
  apiKeyWorkspaceId?: string | null;
  /** Whose reach the credential inherits (`mcp_tokens.subject_user_id`); read only via `isSharedCredential`.
   *  `service-launch-identity.ts › resolveIdentityForDirective` needs it for `canSeeIdentity` (F-333). */
  credentialSubjectUserId: string | null;
  /** Server-resolved from `X-Dopl-Runtime`, bounded by the credential; stamped as `metadata.runtime`. */
  runtime?: DoplRuntime;
  /** Server-resolved from `X-Dopl-App-Version`; stamped as `metadata.appVersion`. */
  appVersion?: string;
  /** The desktop's slot key from `X-Dopl-Session-Id`, stamped as `metadata.session_id` — a label, never a lock. */
  sessionId?: string;
  /** Server-resolved device a MEMBER posts from (`message-source.ts`); stamped as `metadata.source`
   *  on a member post only. Never a request field. */
  messageSource?: MessageSourceStamp;
  /** The presenting `mcp_tokens` row (agent credentials only) — the `metadata.via` lookup key
   *  (`message-via.ts`). Never a request field, never a gate. */
  agentTokenId?: string;
  /** The MCP caller's SELF-DECLARED `initialize` clientInfo (`shared/auth/mcp-client-info.ts`). */
  clientInfo?: McpClientInfo;
}

interface AuthLike {
  userId: string;
  workspaceId: string;
  role?: Role | null;
  workspaceKind?: WorkspaceKind;
  agentTokenId?: string | null;
  /** The container fence — its absence widens rather than narrows. */
  apiKeyWorkspaceId?: string | null;
  /** Required: this axis has no safe default (F-336). */
  credentialSubjectUserId: string | null;
  runtime?: string | null;
  appVersion?: string | null;
  sessionId?: string | null;
  clientInfo?: McpClientInfo | null;
}

export function buildChannelContext(auth: AuthLike): ChannelContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.agentTokenId ? "agent" : "user",
    role: auth.role ?? null,
    workspaceKind: auth.workspaceKind,
    // `null` means unfenced — the wider answer — so auth contexts must pass the lock when there is one.
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
    // No default: the caller must say whose reach this credential carries.
    credentialSubjectUserId: auth.credentialSubjectUserId,
    // Re-narrowed rather than trusted: no ctx off an agent token can claim `desktop-ui`.
    runtime: narrowRuntime(auth.runtime, {
      agentCredential: !!auth.agentTokenId,
    }),
    // Re-narrowed too: both stamps below are rendered on another member's screen.
    appVersion: narrowAppVersion(auth.appVersion),
    sessionId: narrowSessionId(auth.sessionId),
    // Present only on an agent credential, so a person's ctx keeps its old shape.
    ...(auth.agentTokenId && { agentTokenId: auth.agentTokenId }),
    ...(auth.agentTokenId &&
      auth.clientInfo && { clientInfo: narrowClientInfo(auth.clientInfo) ?? undefined }),
  };
}

export const UNIQUE_VIOLATION = "23505";

const NUL = String.fromCharCode(0);

/** Strip NUL (U+0000) before Postgres: text/jsonb reject it, so one stray NUL 500s the whole write. */
export function stripNulDeep<T>(value: T): T {
  if (typeof value === "string") {
    return value.includes(NUL)
      ? (value.split(NUL).join("") as unknown as T)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripNulDeep(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripNulDeep(v);
    return out as T;
  }
  return value;
}

function isWorkspaceAdmin(ctx: ChannelContext): boolean {
  return ctx.role !== null && meetsMinRole(ctx.role, "admin");
}

/** Ref (id or slug) → row, or not-found. Skips the visibility gate, so it stays module-private. */
async function resolveChannelRef(
  ctx: ChannelContext,
  ref: string
): Promise<ChannelRow> {
  const channel = isUuid(ref)
    ? await repo.findChannelById(ctx.workspaceId, ref)
    : await repo.findChannelBySlug(ctx.workspaceId, ref);
  if (!channel) throw new ChannelNotFoundError(ref);
  return channel;
}

/**
 * May this caller reach a `visibility='public'` channel without a `channel_members` row? Not a guest:
 * its reach is the one channel it was admitted to (INVARIANTS §4A). Mirrors the guest arm of
 * `20260826120000_guest_channel_realtime_rls.sql`, which drops the public disjunct.
 */
export function mayReadPublicChannels(ctx: ChannelContext): boolean {
  // A `null` role fails closed.
  return ctx.role !== null && meetsMinRole(ctx.role, "viewer");
}

/**
 * Resolve a channel the caller may read (public arm: {@link mayReadPublicChannels}). A private channel
 * reads as not-found to a non-member; membership is null for a public-channel non-member.
 */
export async function loadVisibleChannel(
  ctx: ChannelContext,
  ref: string
): Promise<{ channel: ChannelRow; membership: ChannelMemberRow | null }> {
  /**
   * ⚠ **ONE WAVE WHEN THE REF IS AN ID, TWO WHEN IT IS A SLUG (2026-10-10,
   * option H).** The membership read needs a channel id, and when `ref` IS one
   * there is nothing to wait for: the row resolved below is the row with that
   * id, so `channel.id === ref` by construction. Every web and desktop read
   * arrives that way (`requireChannelId` in the route), which is where the saved
   * round trip lands — it was 2 of the 6 serial waves a switch-in paid. A SLUG
   * has to be resolved before anything can be read about it, so that arm is
   * unchanged.
   *
   * ⚠ **IT CHANGES NO GATE.** The visibility test below is unmoved and still
   * decides on both rows; overlapping the reads only stops the second waiting on
   * the first. A ref that does not resolve still throws not-found, having wasted
   * one membership read on an id with no rows — which answers null, so there is
   * nothing to leak and nothing is returned.
   */
  const early = isUuid(ref) ? repo.findMembership(ref, ctx.userId) : null;
  // ⚠ A HANDLER SO A REJECTION IS NEVER UNHANDLED. When `resolveChannelRef`
  // throws we never await this one; the `await` below still sees the rejection,
  // because it awaits the promise itself and not this attachment.
  early?.catch(() => {});
  const channel = await resolveChannelRef(ctx, ref);
  const membership = await (early ?? repo.findMembership(channel.id, ctx.userId));
  const viaPublic = channel.visibility === "public" && mayReadPublicChannels(ctx);
  if (!viaPublic && membership === null) {
    // Not-found, never forbidden, so the refusal cannot enumerate the container.
    throw new ChannelNotFoundError(ref);
  }
  return { channel, membership };
}

/**
 * {@link loadVisibleChannel} plus a membership row — the write gate, since a null membership is not a
 * refusal there. `action` is the server-written noun the 403 shows.
 * A suite that spread-mocks `loadVisibleChannel` still hits the real one through here; double this too.
 */
export async function requireMemberChannel(
  ctx: ChannelContext,
  ref: string,
  action: string
): Promise<{ channel: ChannelRow; membership: ChannelMemberRow }> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) throw new ChannelForbiddenError(action);
  return { channel, membership };
}

/** Owner of the channel, or a workspace admin — the management gate. */
export function canManageChannel(
  ctx: ChannelContext,
  membership: ChannelMemberRow | null
): boolean {
  return membership?.role === "owner" || isWorkspaceAdmin(ctx);
}

/**
 * Agent id → operator-given name for a page of messages, in one read. Fenced on the caller's
 * workspace ids, since agent id alone would answer from tenancies nobody proved.
 */
export async function agentNamesFor(
  workspaceIds: readonly string[],
  rows: readonly {
    author_kind: string;
    client_msg_id: string | null;
    metadata: unknown;
  }[]
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.author_kind !== "agent") continue;
    const id = authorAgentIdOf({
      clientMsgId: row.client_msg_id,
      metadata:
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null,
    });
    if (id !== null) ids.add(id);
  }
  if (ids.size === 0) return new Map();
  return repoSessions.agentDisplayNames([...new Set(workspaceIds)], [...ids]);
}

/**
 * The author agent ids a page of rows NAMES — {@link agentNamesFor}'s first half, lifted out so
 * the pair-read below cannot derive them a second way.
 *
 * ⚠ **THE ONE PARSER DECIDES WHICH AGENT WROTE A ROW** (`lib/agent-post-stamp.ts ›
 * authorAgentIdOf`: the post stamp, else the server's own session key), and this only collects its
 * answers. ⚠ Gated on `author_kind`: a person's cookie session carries a `session_id` too.
 */
function authorAgentIdsOf(
  rows: readonly { author_kind: string; client_msg_id: string | null; metadata: unknown }[]
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.author_kind !== "agent") continue;
    const id = authorAgentIdOf({
      clientMsgId: row.client_msg_id,
      metadata:
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null,
    });
    if (id !== null) ids.add(id);
  }
  return [...ids];
}

/**
 * **AGENT ID → ITS NAME *AND* ITS COLOUR for a page of messages, in ONE read** (2026-10-12 — the
 * inbound banner's colour, Samuel).
 *
 * ⚠ **IT REPLACES {@link agentNamesFor} ON THE MESSAGE HYDRATE PATH ONLY**, and the name half is
 * byte-identical in behaviour (`repository-agent-facets.ts › agentNameAndColor` keeps
 * `agentDisplayNames`' blank-name rule). `agentNamesFor` stays for its other callers — the account
 * status read and the workspace hold — which want names alone and must not pay for a wider
 * projection.
 * ⚠ **ONE READ, NOT TWO**, because this is the hot path: every channel page and every long-poll
 * tick lands here, and a second query for the colour would also be a second chance to disagree
 * about one agent inside one rendered row.
 * ⚠ A PURELY HUMAN PAGE STILL COSTS NOTHING — no agent ids, no query.
 */
export async function agentFacesFor(
  workspaceIds: readonly string[],
  rows: readonly {
    author_kind: string;
    client_msg_id: string | null;
    metadata: unknown;
  }[]
): Promise<{ names: Map<string, string>; colors: Map<string, string> }> {
  const ids = authorAgentIdsOf(rows);
  if (ids.length === 0) return { names: new Map(), colors: new Map() };
  return repoAgentFacets.agentNameAndColor([...new Set(workspaceIds)], ids);
}

export async function profilesById(
  userIds: string[]
): Promise<Map<string, ProfileRef>> {
  const unique = [...new Set(userIds)];
  const profiles = await repo.fetchProfiles(unique);
  return new Map(profiles.map((p) => [p.id, p]));
}

/**
 * Rows → message DTOs with both halves of the author resolved (profile + agent name). The only
 * hydrator; it lives here so the read and artifact services both depend down, never on each other.
 */
export async function hydrateMessages(
  rows: ChannelMessageRow[],
  workspaceId: string
): Promise<ChannelMessage[]> {
  const authorIds = rows
    .map((r) => r.author_user_id)
    .filter((id): id is string => id !== null);
  const [profiles, faces] = await Promise.all([
    profilesById(authorIds),
    // ⚠ THE PAIR IN ONE READ since 2026-10-12 — see `agentFacesFor`. The colour is what the
    // agent stream's inbound banner paints with, and it has to arrive on the same row as the
    // name or the two reads can disagree about one agent.
    agentFacesFor([workspaceId], rows),
  ]);
  return rows.map((row) =>
    mapMessageRow(
      row,
      row.author_user_id ? profiles.get(row.author_user_id) : undefined,
      faces.names,
      faces.colors
    )
  );
}
