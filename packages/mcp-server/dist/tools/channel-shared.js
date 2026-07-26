"use strict";
/**
 * Shared resolvers for the `dopl_channel` tool. Channel-reference (slug or
 * id) resolution and member-reference (email or user id) resolution live
 * here because the read and write op modules both lean on them. The
 * registrar (channel.ts) keeps op routing; these are the cross-cutting
 * internals. The `channel-` filename prefix is required by the parity
 * split-scan (parity.test.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isErr = isErr;
exports.channelNotFound = channelNotFound;
exports.resolveChannelOr = resolveChannelOr;
exports.resolveMemberOr = resolveMemberOr;
const respond_1 = require("./respond");
/**
 * True when a resolver returned a ToolResponse error instead of the
 * resolved value. Generic so it narrows both the channel and member
 * resolvers — the caller short-circuits on the error branch.
 */
function isErr(x) {
    return (typeof x === "object" &&
        x !== null &&
        "isError" in x &&
        x.isError === true);
}
/**
 * Uniform not-found error for a channel reference. Shared by the pre-resolve
 * path (resolveChannelOr, below) and the hot read/await handlers, which skip
 * the pre-resolve and instead map a route 404 to this same copy.
 */
function channelNotFound(ref) {
    return (0, respond_1.err)(`Channel not found: "${ref}". Use dopl_channel(op="list") to see channels you can access (pass a slug or id from there).`);
}
/**
 * Resolve a channel reference (slug or UUID) to a `Channel` row, or a
 * not-found ToolResponse error. Lists channels once (including archived,
 * so an archived channel is still addressable) and matches on id or slug —
 * mirrors the `dopl_kb` base-resolution pattern.
 *
 * Used by the write/UX ops (open needs no ref; invite/post pre-resolve so
 * the confirmation can name the channel and catch a bad ref before the
 * mutation). The hot read/await ops deliberately do NOT call this — they
 * pass the ref straight to the route (which resolves slug-or-id + enforces
 * visibility) to avoid a per-call listChannels() round-trip on the poll loop.
 */
async function resolveChannelOr(client, ref) {
    const channels = await client.listChannels({ includeArchived: true });
    const match = channels.find((c) => c.id === ref || c.slug === ref);
    if (!match) {
        return channelNotFound(ref);
    }
    return match;
}
function memberLabel(m) {
    return m.displayName || m.email || m.userId;
}
/**
 * Resolve a member reference (email or user id) to an ACTIVE workspace
 * member, or a ToolResponse error. Invites are in-workspace only, so the
 * invitee must be an active member — a pending/revoked match is rejected
 * with a clear reason. Uses the client's existing workspace-member listing
 * (the same source `dopl_members` reads).
 */
async function resolveMemberOr(client, ref) {
    const trimmed = ref.trim();
    const lower = trimmed.toLowerCase();
    const members = await client.listWorkspaceMembers();
    const byId = members.find((m) => m.userId === trimmed);
    const byEmail = lower.length > 0
        ? members.filter((m) => (m.email ?? "").toLowerCase() === lower)
        : [];
    if (!byId && byEmail.length > 1) {
        return (0, respond_1.err)(`"${ref}" matches ${byEmail.length} members by email — pass a user id instead to disambiguate.`);
    }
    const match = byId ?? (byEmail.length === 1 ? byEmail[0] : undefined);
    if (!match) {
        return (0, respond_1.err)(`No workspace member matching "${ref}". Invites are in-workspace only — pass the email or user id of an ACTIVE member (see dopl_members(op="list")).`);
    }
    if (match.status !== "active") {
        const state = match.status === "pending"
            ? "still has a pending invite (they haven't accepted yet)"
            : "has been deactivated";
        return (0, respond_1.err)(`${memberLabel(match)} ${state}, so they can't be added to a channel — only active workspace members can join.`);
    }
    return { userId: match.userId, label: memberLabel(match) };
}
