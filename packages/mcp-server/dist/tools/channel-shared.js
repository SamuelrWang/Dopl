"use strict";
/**
 * Shared resolvers for `dopl_channel`: channel-reference (slug or id) and
 * member-reference (email or user id) resolution, leaned on by both the read
 * and write op modules. ⚠ `channel-` filename prefix required by the parity
 * split-scan (parity.test.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.neutralizeInline = exports.inlineOr = exports.INLINE_TEXT_MAX = void 0;
exports.metaString = metaString;
exports.memberNames = memberNames;
exports.isErr = isErr;
exports.channelNotFound = channelNotFound;
exports.resolveChannelOr = resolveChannelOr;
exports.resolveMemberOr = resolveMemberOr;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
/**
 * A non-empty string field of a message's metadata, or undefined. ⚠ ONE
 * definition — both the read and write lanes key thread linkage off it
 * (`taskId` / `taskTitle`), so a second copy silently drifts and one lane
 * renders a thread tag the other reported as absent.
 */
function metaString(m, key) {
    const value = m.metadata?.[key];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}
/**
 * ⚠ THE NEUTRALIZER LIVES IN `narration.ts` — re-exported here, never
 * re-declared. Tools with no channel in them need it too (`dopl_members`
 * renders the same `profiles.display_name`, `dopl_chats` a member-typed title,
 * `server.ts` the workspace name in the instructions block and every
 * `_dopl_status` footer), so there is exactly ONE definition.
 */
var narration_2 = require("./narration");
Object.defineProperty(exports, "INLINE_TEXT_MAX", { enumerable: true, get: function () { return narration_2.INLINE_TEXT_MAX; } });
Object.defineProperty(exports, "inlineOr", { enumerable: true, get: function () { return narration_2.inlineOr; } });
Object.defineProperty(exports, "neutralizeInline", { enumerable: true, get: function () { return narration_2.neutralizeInline; } });
/**
 * Channel roster as `userId → display name`, for the ids a thread row carries
 * (`createdBy`, `targetUserId`). ⚠ RAW names — the render side neutralizes
 * exactly once, in {@link memberRef}.
 *
 * ⚠ FAIL-SOFT: enrichment only. A roster that 404s, 403s or times out degrades
 * to ids, never turns a successful thread read into an error the agent retries.
 */
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
        // Enrichment only — ids still render, and they are the half that matters.
    }
    return names;
}
/**
 * True when a resolver returned a ToolResponse error instead of the value.
 * Generic so it narrows both the channel and member resolvers.
 */
function isErr(x) {
    return (typeof x === "object" &&
        x !== null &&
        "isError" in x &&
        x.isError === true);
}
/**
 * Uniform not-found for a channel reference. Shared by `resolveChannelOr` and
 * by the hot read and hold handlers, which skip the pre-resolve and map a route
 * 404 to this same copy.
 */
function channelNotFound(ref) {
    return (0, respond_1.err)(`Channel not found: "${ref}". Use dopl_channel(op="rooms", action="list") to see channels you can access (pass a slug or id from there).`);
}
/**
 * Resolve a channel reference (slug or UUID) to a `Channel` row, or a not-found
 * error. Lists channels once INCLUDING ARCHIVED, so an archived channel stays
 * addressable, and matches on id or slug.
 *
 * Used by the write ops so a confirmation can name the channel and a bad ref is
 * caught before the mutation. ⚠ The hot read and hold shapes must NOT call this —
 * they pass the ref straight to the route (which resolves slug-or-id and
 * enforces visibility), avoiding a listChannels() round-trip per poll.
 */
async function resolveChannelOr(client, ref) {
    const channels = await client.listChannels({ includeArchived: true });
    const match = channels.find((c) => c.id === ref || c.slug === ref);
    if (!match) {
        return channelNotFound(ref);
    }
    return match;
}
/**
 * How a workspace member is NAMED in tool output — ⚠ neutralized AT THE SOURCE.
 * `displayName` is self-set `profiles.display_name`, spliced into ten-odd
 * write-op lines carrying no untrusted framing at all.
 *
 * ⚠ Here rather than per call site because `label` is the ONLY thing callers do
 * with a `ResolvedMember` besides `userId`: safe by construction means a later
 * call site cannot reintroduce the defect. `userId` stays raw — server-issued
 * UUID, the half a member does not control.
 *
 * ⚠ The route bound (`src/app/api/user/profile/route.ts`) and the DB CHECK are
 * not reasons to render raw: RLS lets a user PATCH the column straight through
 * PostgREST, the CHECK is written but NOT APPLIED, and the `email` fallback is
 * bounded by no charset rule either.
 */
function memberLabel(m) {
    return (0, narration_1.inlineOr)(m.displayName || m.email || m.userId, "(unnamed member)");
}
/**
 * Resolve a member reference (email or user id) to an ACTIVE workspace member,
 * or an error. ⚠ Invites are in-workspace only, so a pending/revoked match is
 * rejected with a stated reason. Reads the same listing `dopl_members` does.
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
        return (0, respond_1.err)(`No workspace member matching "${ref}". Invites are in-workspace only — pass the email or user id of an ACTIVE member (see dopl_members(op="rooms" action="list")).`);
    }
    if (match.status !== "active") {
        const state = match.status === "pending"
            ? "still has a pending invite (they haven't accepted yet)"
            : "has been deactivated";
        return (0, respond_1.err)(`${memberLabel(match)} ${state}, so they can't be added to a channel — only active workspace members can join.`);
    }
    return { userId: match.userId, label: memberLabel(match) };
}
