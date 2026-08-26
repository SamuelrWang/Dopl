import "server-only";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { narrowAppVersion } from "@/shared/auth/app-version-header";
import { narrowRuntime, type DoplRuntime } from "@/shared/auth/runtime-header";
import { narrowSessionId } from "@/shared/auth/session-header";
import { isUuid } from "@/shared/lib/id/uuid";
import { ChannelNotFoundError } from "./errors";
import type { ChannelMemberRow, ChannelRow, ProfileRef } from "./dto";
import * as repo from "./repository";

/**
 * Shared internals for the channels service: the `ChannelContext`
 * construction plus the cross-cutting resolvers + visibility / management
 * gates used by more than one of the per-domain service modules
 * (`service-reads`, `service-writes`).
 */

export interface ChannelContext {
  workspaceId: string;
  userId: string;
  source: "user" | "agent";
  /** Caller's workspace role; null when the auth layer didn't resolve one. */
  role: Role | null;
  /**
   * Workspace a workspace-scoped API key is locked to; `null` for session
   * callers and user-scoped keys (2026-08-23).
   *
   * ⚠ **CARRIED FOR EXACTLY ONE READER AND IT IS A FENCE, NOT A HINT.**
   * `service-launch.ts › resolveTemplateForDirective` hands it to
   * `agent-templates › canSeeTemplate`, whose SECOND arm is M-10: a
   * workspace-scoped key may be shared between humans, so it inherits nobody's
   * personal reach and sees only `visibility: 'workspace'` rows. Building that
   * context with `null` would let such a key resolve the key-owner's PRIVATE
   * templates by name. Nothing else in channels reads it — the channel fences are
   * membership rows, not per-person visibility.
   */
  apiKeyWorkspaceId?: string | null;
  /** Which Dopl runtime the request speaks for: `desktop-session` (spawned
   *  session), `desktop-ui` (operator typing in the app), undefined for
   *  everything else. ⚠ Server-resolved from `X-Dopl-Runtime` and bounded by the
   *  credential; stamped as the reserved `metadata.runtime` key. */
  runtime?: DoplRuntime;
  /** Which BUILD of the desktop app the request speaks for. Server-resolved from
   *  `X-Dopl-App-Version`; stamped as reserved `metadata.appVersion` so the OTHER
   *  machine can explain a behaviour gap instead of guessing. */
  appVersion?: string;
  /** Which SESSION this request speaks for (the desktop's slot key), undefined
   *  when unstamped. Server-resolved from `X-Dopl-Session-Id`; stamped as
   *  reserved `metadata.session_id` so a reader can tell two concurrent sessions
   *  of ONE handle apart. ⚠ A LABEL, never a lock. */
  sessionId?: string;
}

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role?: Role | null;
  agentTokenId?: string | null;
  /** ⚠ See {@link ChannelContext.apiKeyWorkspaceId} — the M-10 fence, and the
   *  one field on this context whose ABSENCE widens rather than narrows. */
  apiKeyWorkspaceId?: string | null;
  runtime?: string | null;
  appVersion?: string | null;
  sessionId?: string | null;
}

export function buildChannelContext(auth: AuthLike): ChannelContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.agentTokenId ? "agent" : "user",
    role: auth.role ?? null,
    // ⚠ `?? null`, so a caller that forgot the field gets the RESTRICTIVE value
    // for every *other* fence — but note this one reads backwards: `null` means
    // "not a workspace key", which is the WIDER answer at `canSeeTemplate`'s arm
    // 2. That is why `WorkspaceAuthContext` always sets it explicitly and why
    // this line exists at all rather than the field being left off the context.
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
    // ⚠ Re-narrowed rather than trusted: a second check through the SAME
    // predicate means no other construction path can widen what counts as a
    // desktop runtime — no ctx off an agent token can claim `desktop-ui`.
    runtime: narrowRuntime(auth.runtime, {
      agentCredential: !!auth.agentTokenId,
    }),
    // Same shape: re-run the header's own predicate so a version reaching an
    // operator's screen IS a version, whatever built this ctx.
    appVersion: narrowAppVersion(auth.appVersion),
    // And again for the session stamp — rendered into a message line on the
    // OTHER member's screen, so it is id-shaped or it is nothing.
    sessionId: narrowSessionId(auth.sessionId),
  };
}

export const UNIQUE_VIOLATION = "23505";

const NUL = String.fromCharCode(0);

/**
 * ⚠ Strip NUL (U+0000) from every string before it reaches Postgres — text/jsonb
 * reject the code point, so a stray one 500s the whole write. Stripped rather
 * than rejected: NUL carries no meaning in a channel message.
 */
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

// ⚠ MODULE-PRIVATE. Keeping the RAW resolve — the one that SKIPS the visibility
// gate — unexported is what stops it being reachable outside this file.
function isWorkspaceAdmin(ctx: ChannelContext): boolean {
  return ctx.role !== null && meetsMinRole(ctx.role, "admin");
}

/** Resolve a `channel` ref (UUID id or slug) to its row, or throw not-found. */
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
 * 🔒 MAY THIS CALLER REACH A CHANNEL ON THE `visibility='public'` ARM ALONE —
 * that is, WITHOUT a `channel_members` row? (2026-08-26.)
 *
 * ⚠ A GUEST MAY NOT, AND THAT IS THE ONE ASYMMETRY IN THE READ MODEL. "Public"
 * means *any workspace member can see and join*, which is a statement about a
 * TENANCY. A guest has no tenancy: they were admitted to ONE channel by a
 * single-use link, and §4A's whole claim is that their reach is that channel.
 *
 * WHAT THIS CLOSES, measured: nothing stops a `visibility='public'` channel
 * being created inside a `kind='link'` container — `createChannel` never reads
 * `workspace.kind`, `POST /api/channels` is `member`+ (the container's owner
 * clears it), the MCP `dopl_channel(op="open")` schema offers `visibility` and
 * no DB constraint exists. ELEVEN of the fourteen guest-floored CHANNEL routes
 * compose `loadVisibleChannel` — measured 2026-08-26; the three that do not are
 * `channels/route.ts` GET, `channels/await/route.ts` GET and
 * `channels/presence/route.ts` POST, none of which takes a channel ref. ⚠ This
 * comment has now been wrong twice ("twelve", and elsewhere "seven"), so
 * RE-DERIVE rather than quote: walk each pair in `guest-route-floor.test.ts ›
 * GUEST_ALLOWED` to the service function its route calls, and check that
 * function against `grep -rn loadVisibleChannel src/features/channels/server`.
 * Before this fence an operator opening a second, public channel in their
 * container silently handed the guest its header, its whole transcript, its
 * thread list, its roster and a long-poll on it. A lowered floor plus an
 * inherited public arm is exactly how a narrow grant becomes a cross-channel
 * read.
 *
 * ⚠ IT MIRRORS THE DATABASE, WHICH IS WHY IT IS SPELLED THIS WAY.
 * `20260826120000_guest_channel_realtime_rls.sql`'s guest arm requires
 * `is_channel_member(...)` and deliberately drops the `visibility='public'`
 * disjunct. Service and RLS now state the SAME rule; a future edit to one that
 * forgets the other is a disagreement a reader can find.
 *
 * ⚠ NOTHING CHANGES FOR ANY OTHER ROLE. `meetsMinRole(role,'viewer')` is true
 * for viewer/member/admin/owner, so the public arm is exactly what it was.
 */
export function mayReadPublicChannels(ctx: ChannelContext): boolean {
  // ⚠ `null` FAILS CLOSED, the same shape `isWorkspaceAdmin` uses. A null role
  // means the auth layer resolved none; every guest-reachable route is
  // `withWorkspaceAuth`-wrapped and therefore always carries one, and every
  // internal builder passes `role: "owner"` explicitly — so null is the
  // unexpected case, and the unexpected case must not be the wider one.
  return ctx.role !== null && meetsMinRole(ctx.role, "viewer");
}

/**
 * Resolve a channel the caller may READ. Public = any workspace member at
 * `viewer` or above (see {@link mayReadPublicChannels} — a guest is fenced to
 * channels it actually belongs to);
 * ⚠ a private channel reads as NOT-FOUND to a non-member, so its existence never
 * leaks. Returns the row plus membership (null for a public-channel non-member).
 */
export async function loadVisibleChannel(
  ctx: ChannelContext,
  ref: string
): Promise<{ channel: ChannelRow; membership: ChannelMemberRow | null }> {
  const channel = await resolveChannelRef(ctx, ref);
  const membership = await repo.findMembership(channel.id, ctx.userId);
  const viaPublic = channel.visibility === "public" && mayReadPublicChannels(ctx);
  if (!viaPublic && membership === null) {
    // ⚠ NOT-FOUND, never FORBIDDEN — same answer a private channel gives a
    // non-member, so a guest cannot use the refusal to enumerate the container.
    throw new ChannelNotFoundError(ref);
  }
  return { channel, membership };
}

/** Owner of the channel, or a workspace admin — the management gate. */
export function canManageChannel(
  ctx: ChannelContext,
  membership: ChannelMemberRow | null
): boolean {
  return membership?.role === "owner" || isWorkspaceAdmin(ctx);
}

export async function profilesById(
  userIds: string[]
): Promise<Map<string, ProfileRef>> {
  const unique = [...new Set(userIds)];
  const profiles = await repo.fetchProfiles(unique);
  return new Map(profiles.map((p) => [p.id, p]));
}
