import "server-only";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { narrowAppVersion } from "@/shared/auth/app-version-header";
import {
  DESKTOP_SESSION_RUNTIME,
  type DoplRuntime,
} from "@/shared/auth/runtime-header";
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
   * Which agent runtime the request speaks for — `desktop-session` for a
   * session the desktop app spawned, undefined for everything else (the web
   * UI, an external Claude Code session, a script). Server-resolved from the
   * `X-Dopl-Runtime` header by the auth layer; the write path stamps it onto
   * a message as the reserved `metadata.runtime` key.
   */
  runtime?: DoplRuntime;
  /**
   * Which BUILD of the desktop app the request speaks for (`1.7.15`), or
   * undefined for everything else. Server-resolved from the
   * `X-Dopl-App-Version` header by the auth layer; the write path stamps it
   * onto a message as the reserved `metadata.appVersion` key so the OTHER
   * machine can explain a behavior gap instead of guessing at one (Q10).
   */
  appVersion?: string;
  /**
   * WHICH SESSION of an agent this request speaks for (the desktop's slot key),
   * or undefined for a caller that sends no stamp. Server-resolved from the
   * `X-Dopl-Session-Id` header by the auth layer; the write path stamps it onto
   * a message as the reserved `metadata.session_id` key so a reader can tell two
   * concurrent sessions of ONE agent handle apart (F2). A LABEL, never a lock —
   * nothing enforces one live session per agent.
   */
  sessionId?: string;
}

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role?: Role | null;
  agentTokenId?: string | null;
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
    // Re-narrowed here rather than trusted as-is: the auth layer already
    // exact-matches the header, and a second check means no other construction
    // path can widen what counts as a desktop session.
    runtime:
      auth.runtime === DESKTOP_SESSION_RUNTIME
        ? DESKTOP_SESSION_RUNTIME
        : undefined,
    // Same reason, same shape: re-run the header's own predicate so a version
    // that reaches an operator's screen is a version, whatever built this ctx.
    appVersion: narrowAppVersion(auth.appVersion),
    // And again for the session stamp (F2) — it is rendered into a message line
    // on the OTHER member's screen, so it is an id-shaped token or it is nothing.
    sessionId: narrowSessionId(auth.sessionId),
  };
}

export const UNIQUE_VIOLATION = "23505";

const NUL = String.fromCharCode(0);

/**
 * Strip NUL (U+0000) from every string in a payload before it reaches
 * Postgres (mirrors the chats write boundary): Postgres text/jsonb reject
 * the NUL code point, so an agent posting a stray one would otherwise 500
 * the whole write. NUL carries no meaning in a channel message, so it is
 * stripped rather than rejected.
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

export function isWorkspaceAdmin(ctx: ChannelContext): boolean {
  return ctx.role !== null && meetsMinRole(ctx.role, "admin");
}

/** Resolve a `channel` ref (UUID id or slug) to its row, or throw not-found. */
export async function resolveChannelRef(
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
 * Resolve a channel the caller may READ: public channels are visible to
 * any workspace member; a private channel reads as not-found unless the
 * caller is a member (so its existence never leaks). Returns the row plus
 * the caller's membership (null for a non-member viewing a public channel).
 */
export async function loadVisibleChannel(
  ctx: ChannelContext,
  ref: string
): Promise<{ channel: ChannelRow; membership: ChannelMemberRow | null }> {
  const channel = await resolveChannelRef(ctx, ref);
  const membership = await repo.findMembership(channel.id, ctx.userId);
  if (channel.visibility !== "public" && membership === null) {
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
