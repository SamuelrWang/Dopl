/**
 * Shared resolvers for `dopl_channel` (channel by slug/id, member by email/id). The `channel-`
 * filename prefix is required by the parity split-scan.
 */

import { callRef, toolName } from "../call-ref.js";
import type {
  Channel,
  ChannelMessage,
  DoplClient,
  WorkspaceMember,
} from "@dopl/client";
import { inlineOr } from "./narration";
import { err, type ToolResponse } from "./respond";

/** A non-empty string metadata field; one definition, since both lanes key thread linkage off it. */
export function metaString(m: ChannelMessage, key: string): string | undefined {
  const value = (m.metadata as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/** The one neutralizer lives in `narration.ts`; re-exported, never re-declared. */
export { INLINE_TEXT_MAX, inlineOr, neutralizeInline } from "./narration";

/** Roster as `userId → raw name` (the render neutralizes once). Fail-soft: enrichment only, ids
 *  still render. */
export async function memberNames(
  client: DoplClient,
  ref: string,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    for (const m of await client.listChannelMembers(ref)) {
      const name = m.displayName || m.email;
      if (m.userId && name) names.set(m.userId, name);
    }
  } catch {
    // Enrichment only.
  }
  return names;
}

/** The one `isErr` for every lane; object-guarded, so a non-object rejection never throws on `in`. */
export function isErr<T>(x: T | ToolResponse): x is ToolResponse {
  return (
    typeof x === "object" &&
    x !== null &&
    "isError" in x &&
    (x as ToolResponse).isError === true
  );
}

/** Uniform channel not-found, also used by the hot read/hold paths that map a route 404. */
export function channelNotFound(ref: string): ToolResponse {
  return err(
    `Channel not found: "${ref}". Use ${callRef("channel.rooms.list")} to see channels you can access (pass a slug or id from there).`,
  );
}

/** Channel by id or slug, or not-found. For write ops only: hot read/hold paths pass the ref to the
 *  route (which resolves and enforces visibility) to avoid a list per poll. */
export async function resolveChannelOr(
  client: DoplClient,
  ref: string,
): Promise<Channel | ToolResponse> {
  const channels = await client.listChannels();
  const match = channels.find((c) => c.id === ref || c.slug === ref);
  if (!match) {
    return channelNotFound(ref);
  }
  return match;
}

export interface ResolvedMember {
  userId: string;
  /** Already render-safe (one code span); neutralizing again strips its backticks. */
  label: string;
}

/** A member's name, neutralized at the source (self-set display names reach many write-op lines;
 *  the route bound and DB CHECK are not a reason to render raw). */
function memberLabel(m: WorkspaceMember): string {
  return inlineOr(m.displayName || m.email || m.userId, "(unnamed member)");
}

/** Member by email or user id; only an ACTIVE member resolves (pending/revoked refused, with why). */
export async function resolveMemberOr(
  client: DoplClient,
  ref: string,
): Promise<ResolvedMember | ToolResponse> {
  const trimmed = ref.trim();
  const lower = trimmed.toLowerCase();
  const members = await client.listWorkspaceMembers();

  const byId = members.find((m) => m.userId === trimmed);
  const byEmail =
    lower.length > 0
      ? members.filter((m) => (m.email ?? "").toLowerCase() === lower)
      : [];
  if (!byId && byEmail.length > 1) {
    return err(
      `"${ref}" matches ${byEmail.length} members by email — pass a user id instead to disambiguate.`,
    );
  }
  const match = byId ?? (byEmail.length === 1 ? byEmail[0] : undefined);
  if (!match) {
    return err(
      `No workspace member matching "${ref}". Invites are in-workspace only — pass the email or user id of an ACTIVE member (${toolName("members.list")} lists them).`,
    );
  }
  if (match.status !== "active") {
    const state =
      match.status === "pending"
        ? "still has a pending invite (they haven't accepted yet)"
        : "has been deactivated";
    return err(
      `${memberLabel(match)} ${state}, so they can't be added to a channel — only active workspace members can join.`,
    );
  }
  return { userId: match.userId, label: memberLabel(match) };
}
