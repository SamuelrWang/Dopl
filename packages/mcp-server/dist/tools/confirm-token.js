"use strict";
/**
 * The confirm class: a dry-run preview plus an opaque server-minted token the acting call must echo back.
 * A tripwire, not a fence, for publishing into a container other people stand in (any second member, whatever the
 * kind — F-513): it proves the agent SAW the act, not that a human approved it. What refuses is the server
 * (credential lock, audience ceiling in `service-audience.ts`, and `shared-publish.ts`'s 400).
 * The store is module-scoped (the server boots per request); an unknown token refuses, so a lost store means "preview again".
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECONFIRM_REMEDY = void 0;
exports.resolveConfirmTarget = resolveConfirmTarget;
exports.refuseStrayToken = refuseStrayToken;
exports.containerPublishUnacknowledged = containerPublishUnacknowledged;
exports.confirmGate = confirmGate;
exports.__resetConfirmTokensForTest = __resetConfirmTokensForTest;
const node_crypto_1 = require("node:crypto");
const client_1 = require("@dopl/client");
const shared_room_js_1 = require("../shared-room.js");
const narration_js_1 = require("./narration.js");
const respond_js_1 = require("./respond.js");
/** Short-lived so the preview is still in the agent's context when it acts. */
const TOKEN_TTL_MS = 5 * 60_000;
/** Expired rows linger so "expired" can be said rather than answered as "never existed". */
const TOKEN_GRACE_MS = 30 * 60_000;
const TOKEN_STORE_MAX = 200;
const TOKENS = new Map();
function sweep(now) {
    for (const [token, rec] of TOKENS) {
        if (now > rec.expiresAt + TOKEN_GRACE_MS)
            TOKENS.delete(token);
    }
    // Evict oldest (insertion order) rather than refuse to mint: a full store must never block a preview.
    while (TOKENS.size >= TOKEN_STORE_MAX) {
        const oldest = TOKENS.keys().next();
        if (oldest.done)
            break;
        TOKENS.delete(oldest.value);
    }
}
/** Digest binding the token to the caller who previewed, the target workspace and the exact act (key-sorted). */
function fingerprint(act, target) {
    const canonical = JSON.stringify({
        tool: act.tool,
        op: act.op,
        caller: act.callerUserId ?? "unresolved",
        workspace: target.workspaceId ?? "unresolved",
        payload: sortedPayload(act.payload),
    });
    return (0, node_crypto_1.createHash)("sha256").update(canonical).digest("hex");
}
function sortedPayload(payload) {
    return Object.entries(payload)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
function mint(fp) {
    const now = Date.now();
    sweep(now);
    // Random, never payload-derived: a computable token would let the agent skip the preview.
    const token = (0, node_crypto_1.randomBytes)(18).toString("base64url");
    TOKENS.set(token, { fingerprint: fp, expiresAt: now + TOKEN_TTL_MS });
    return token;
}
function consume(token, fp) {
    const rec = TOKENS.get(token);
    if (!rec)
        return "unknown";
    if (Date.now() > rec.expiresAt)
        return "expired";
    // A mismatch does not burn the token: it stays valid for the payload it was minted for.
    if (rec.fingerprint !== fp)
        return "mismatch";
    // Single use.
    TOKENS.delete(token);
    return "ok";
}
const UNKNOWN_TARGET = {
    workspaceId: null,
    label: "`(workspace could not be read)`",
    sharedContainer: true,
    unknown: true,
};
/** Resolves the workspace this call landed in — the per-call ALS override first, then the session default. */
async function resolveConfirmTarget(client) {
    const workspaceId = client_1.workspaceContext.getStore() ?? client.getWorkspaceId();
    if (!workspaceId)
        return UNKNOWN_TARGET;
    try {
        const { workspaces } = await client.listWorkspaces();
        const found = workspaces.find((w) => w.id === workspaceId);
        if (!found)
            return { ...UNKNOWN_TARGET, workspaceId };
        return {
            workspaceId,
            label: (0, narration_js_1.inlineOr)(found.name, "`(unnamed workspace)`"),
            // Member count only, no kind term (F-513); an unreadable count is not solo (`../shared-room.js`).
            sharedContainer: (0, shared_room_js_1.isSharedRoom)(found.memberCount),
            unknown: false,
        };
    }
    catch {
        return { ...UNKNOWN_TARGET, workspaceId };
    }
}
const PROCEED = { kind: "proceed", acknowledgedShared: false };
const PROCEED_ACKNOWLEDGED = {
    kind: "proceed",
    acknowledgedShared: true,
};
/** A token on a call outside the confirm class is refused, not ignored (as `registrar.ts › strictInput` does). */
function refuseStrayToken(tool, op) {
    return (0, respond_js_1.err)(`\`confirm_token\` was passed to ${tool} op="${op}", but this call is not audience-changing — it creates something only you can see, so there is no preview to confirm and nothing was created. Re-issue WITHOUT \`confirm_token\`. Tokens are only ever minted for a write that publishes into a shared home channel.`);
}
/** Maps the server's 400 `CONTAINER_PUBLISH_UNACKNOWLEDGED`; the remedy is the caller's because it differs by op. */
function containerPublishUnacknowledged(e, remedy) {
    if (!(0, respond_js_1.isApiError)(e, 400, "CONTAINER_PUBLISH_UNACKNOWLEDGED"))
        return null;
    return (0, respond_js_1.err)(`Nothing was written. This would publish into a home channel somebody ELSE is standing in, and the server requires that the audience change be acknowledged. ${remedy}`);
}
/** For a previewed op, that 400 means the room changed under the token, so the remedy is a fresh preview. */
exports.RECONFIRM_REMEDY = `Re-issue the SAME call WITHOUT \`confirm_token\` to get a fresh preview of who would see it, then confirm THAT one.`;
/**
 * The gate: call after local refusals, before the client write. Not publishing or a solo room proceeds (a stray token
 * is refused); a shared room with no token runs `precheck`, then previews with a fresh token; with a token it verifies
 * and proceeds with `acknowledgedShared: true`.
 */
async function confirmGate(client, act, opts) {
    const token = opts.token?.trim() ?? "";
    if (!opts.publishes) {
        return token
            ? { kind: "halt", response: refuseStrayToken(act.tool, act.op) }
            : PROCEED;
    }
    const target = await resolveConfirmTarget(client);
    if (!target.sharedContainer) {
        return token
            ? { kind: "halt", response: refuseStrayToken(act.tool, act.op) }
            : PROCEED;
    }
    const fp = fingerprint(act, target);
    if (!token) {
        // Precheck before `mint`: the preview text is built from the token.
        const refusal = opts.precheck ? await opts.precheck() : null;
        if (refusal)
            return { kind: "halt", response: refusal };
        return { kind: "halt", response: preview(act, target, mint(fp)) };
    }
    const verdict = consume(token, fp);
    if (verdict === "ok")
        return PROCEED_ACKNOWLEDGED;
    return { kind: "halt", response: tokenRefusal(act, verdict) };
}
/** The dry run, returned as `isError` so nothing reads as a success. */
function preview(act, target, token) {
    return (0, respond_js_1.err)([
        `NOTHING WAS CREATED — this is a dry run. ${act.tool} op="${act.op}" would publish into a home channel somebody ELSE is in, so it previews first.`,
        "",
        `**What would be created:** ${act.what}`,
        `**Where:** ${target.label}${target.unknown ? " — ⚠ this home channel could not be read, so it is being treated as a shared room" : " (a home channel with at least one other person in it)"}`,
        `**Who would see it:** ${act.audience}`,
        "",
        `To go ahead, re-issue the SAME call with \`confirm_token="${token}"\` and every other argument UNCHANGED. The token is single-use, expires in 5 minutes, and is bound to this exact payload — changing any field invalidates it and you get a fresh preview instead of a surprise.`,
        `⚠ This is a step that makes you LOOK, not a permission check. If you are not sure your operator wants this shared with the other people in that channel, ASK THEM rather than echoing the token back.`,
    ].join("\n"));
}
function tokenRefusal(act, verdict) {
    const why = verdict === "expired"
        ? `that \`confirm_token\` EXPIRED (they last 5 minutes)`
        : verdict === "mismatch"
            ? `that \`confirm_token\` was minted for a DIFFERENT payload — at least one argument changed since the preview`
            : `that \`confirm_token\` is not recognised: it was already used, it was minted somewhere this request cannot see, or it was never issued`;
    return (0, respond_js_1.err)(`Nothing was created — ${why}. Re-issue ${act.tool} op="${act.op}" WITHOUT \`confirm_token\` to get a fresh preview of exactly what would land and who would see it, then confirm that one. Do not guess a token: they are random and a wrong one can only ever refuse.`);
}
/** Test-only: clears the process-lifetime store. */
function __resetConfirmTokensForTest() {
    TOKENS.clear();
}
