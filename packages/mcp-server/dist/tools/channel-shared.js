"use strict";
/**
 * Shared resolvers for `dopl_channel` (channel by slug/id, member by email/id). The `channel-`
 * filename prefix is required by the parity split-scan.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.neutralizeInline = exports.inlineOr = exports.INLINE_TEXT_MAX = void 0;
exports.metaString = metaString;
exports.memberNames = memberNames;
exports.isErr = isErr;
exports.channelNotFound = channelNotFound;
exports.resolveChannelOr = resolveChannelOr;
exports.resolveMemberOr = resolveMemberOr;
const call_ref_js_1 = require("../call-ref.js");
const narration_1 = require("./narration");
const respond_1 = require("./respond");
/** A non-empty string metadata field; one definition, since both lanes key thread linkage off it. */
function metaString(m, key) {
    const value = m.metadata?.[key];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}
/** The one neutralizer lives in `narration.ts`; re-exported, never re-declared. */
var narration_2 = require("./narration");
Object.defineProperty(exports, "INLINE_TEXT_MAX", { enumerable: true, get: function () { return narration_2.INLINE_TEXT_MAX; } });
Object.defineProperty(exports, "inlineOr", { enumerable: true, get: function () { return narration_2.inlineOr; } });
Object.defineProperty(exports, "neutralizeInline", { enumerable: true, get: function () { return narration_2.neutralizeInline; } });
/** Roster as `userId → raw name` (the render neutralizes once). Fail-soft: enrichment only, ids
 *  still render. */
async function memberNames(client, ref) {
    const names = new Map();
    try {
        for (const m of await client.listChannelMembers(ref)) {
            const name = m.displayName || m.email;
            if (m.userId && name)
                names.set(m.userId, name);
        }
    }
    catch {
        // Enrichment only.
    }
    return names;
}
/** The one `isErr` for every lane; object-guarded, so a non-object rejection never throws on `in`. */
function isErr(x) {
    return (typeof x === "object" &&
        x !== null &&
        "isError" in x &&
        x.isError === true);
}
/** Uniform channel not-found, also used by the hot read/hold paths that map a route 404. */
function channelNotFound(ref) {
    return (0, respond_1.err)(`Channel not found: "${ref}". Use ${(0, call_ref_js_1.callRef)("channel.rooms.list")} to see channels you can access (pass a slug or id from there).`);
}
/** Channel by id or slug, or not-found. For write ops only: hot read/hold paths pass the ref to the
 *  route (which resolves and enforces visibility) to avoid a list per poll. */
async function resolveChannelOr(client, ref) {
    const channels = await client.listChannels();
    const match = channels.find((c) => c.id === ref || c.slug === ref);
    if (!match) {
        return channelNotFound(ref);
    }
    return match;
}
/** A member's name, neutralized at the source (self-set display names reach many write-op lines;
 *  the route bound and DB CHECK are not a reason to render raw). */
function memberLabel(m) {
    return (0, narration_1.inlineOr)(m.displayName || m.email || m.userId, "(unnamed member)");
}
/** Member by email or user id; only an ACTIVE member resolves (pending/revoked refused, with why). */
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
        return (0, respond_1.err)(`No workspace member matching "${ref}". Invites are in-workspace only — pass the email or user id of an ACTIVE member (${(0, call_ref_js_1.toolName)("members.list")} lists them).`);
    }
    if (match.status !== "active") {
        const state = match.status === "pending"
            ? "still has a pending invite (they haven't accepted yet)"
            : "has been deactivated";
        return (0, respond_1.err)(`${memberLabel(match)} ${state}, so they can't be added to a channel — only active workspace members can join.`);
    }
    return { userId: match.userId, label: memberLabel(match) };
}
