"use strict";
/**
 * confirm-token.ts — THE CONFIRM CLASS: a dry-run PREVIEW plus an opaque,
 * server-minted token that the acting call must echo back (Samuel's ruling Q10
 * (ii), 2026-08-28; spec `docs/specs/mcp-surface-v2.plan.md` §7.3).
 *
 * 🔒 ⚠ **A CONFIRM TOKEN IS A TRIPWIRE, NOT A FENCE.** Nothing here stops an
 * agent calling the preview and echoing the token back without ever showing a
 * human. What actually REFUSES the human-reaching acts is the `sessionOnly`
 * set, the `source === "agent"` refusals, B1 (the credential lock) and layer A
 * (the audience ceiling in `src/features/knowledge/server/service-audience.ts`).
 * The token buys that the agent SAW what it was about to do — which is worth
 * having, and is not the same as a person having approved it. Do not describe
 * this module as containment, and do not let a caller's copy imply it.
 *
 * ⚠ **ONE THING DID BECOME A FENCE, AND ONLY ONE (G16, A11).** A SPENT token
 * now yields `acknowledgedShared: true`, which the caller puts on the write body
 * as `acknowledgeShared` — and `src/features/workspaces/server/
 * shared-publish.ts` answers **400 `CONTAINER_PUBLISH_UNACKNOWLEDGED`** to a
 * publish into a shared `kind='link'` container that arrives without it. That
 * refusal is the SERVER'S, so skipping this module does not skip it. It still
 * does not mean a human approved anything — an agent can set the flag by
 * previewing and confirming alone — so every sentence above stands. What
 * changed is only that the act can no longer happen with NOTHING said about the
 * audience, anywhere in the stack.
 *
 * ⚠ SCOPED TO THE AUDIENCE-CHANGING WRITE CLASS AND NOTHING ELSE. A confirm on
 * every write trains the agent to skip it — the identical argument INVARIANTS
 * §10 makes for untrusted-content headers ("a header on every result trains
 * agents to skip headers"). Today the class is exactly: a template or a
 * knowledge base landing at an audience BEYOND THE CALLER inside a SHARED link
 * container, i.e. the room a peer is standing in.
 *
 * ── THE STORE, AND WHY ITS FAILURE MODE IS THE RIGHT ONE ───────────────────
 * ⚠ THE MCP SERVER BOOTS ONCE PER HTTP REQUEST (`factory.ts › bootServer`), so
 * the store is MODULE-scoped, not session-scoped — it lives as long as the Node
 * process. A token minted in one process is UNKNOWN in another, and an unknown
 * token REFUSES: the failure mode of a lost store is "preview again", never
 * "the write goes through". That is the only direction this may ever fail.
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
const workspace_directory_js_1 = require("../workspace-directory.js");
const narration_js_1 = require("./narration.js");
const respond_js_1 = require("./respond.js");
/** ⚠ SHORT-LIVED on purpose: the preview must be the thing the agent is still
 *  holding when it acts, not something it found in an old turn. */
const TOKEN_TTL_MS = 5 * 60_000;
/** Expired rows are kept this much longer so "expired" can be SAID rather than
 *  answered as "never existed" — two different next actions. */
const TOKEN_GRACE_MS = 30 * 60_000;
/** Hard bound on the store; a preview an agent never confirms costs one row. */
const TOKEN_STORE_MAX = 200;
const TOKENS = new Map();
function sweep(now) {
    for (const [token, rec] of TOKENS) {
        if (now > rec.expiresAt + TOKEN_GRACE_MS)
            TOKENS.delete(token);
    }
    // ⚠ Insertion-ordered map: the oldest key is the first. Evicting the oldest
    // beats refusing to mint — a full store must never turn a confirm-class call
    // into an un-previewable one.
    while (TOKENS.size >= TOKEN_STORE_MAX) {
        const oldest = TOKENS.keys().next();
        if (oldest.done)
            break;
        TOKENS.delete(oldest.value);
    }
}
/**
 * The exact act, canonicalised. ⚠ KEY-SORTED so two spellings of the same
 * payload fingerprint identically, and the CALLER and the WORKSPACE are part of
 * it — a token minted for one person's act in one room cannot be spent on
 * another's.
 */
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
    // ⚠ UNGUESSABLE IS THE WHOLE MECHANISM. A token derived from the payload
    // would be computable by the agent, and the preview it is supposed to force
    // into context could be skipped.
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
    // ⚠ A MISMATCH DOES NOT BURN THE TOKEN. It is still valid for the payload it
    // was minted for, and the caller's fix is to send THAT payload — burning it
    // here would make a typo cost a second preview.
    if (rec.fingerprint !== fp)
        return "mismatch";
    // ⚠ SINGLE USE. Deleted on success so a replayed token cannot create a second
    // row nothing can tell apart from the first.
    TOKENS.delete(token);
    return "ok";
}
const UNKNOWN_TARGET = {
    workspaceId: null,
    label: "`(workspace could not be read)`",
    sharedContainer: true,
    unknown: true,
};
/**
 * Resolve the workspace this call actually landed in.
 *
 * ⚠ READS THE ALS OVERRIDE FIRST. `registrar.ts` runs the handler inside
 * `workspaceContext.run(resolvedId, …)` for a per-call `workspace=`, and the
 * transport's stored id is the SESSION default — reading only the latter would
 * ask "is my default workspace a container" about a call that went elsewhere.
 *
 * ⚠ ONE loopback, on a COLD path: it runs only for a write that is already
 * asking to publish. Nothing on the hot read paths pays for it.
 */
async function resolveConfirmTarget(client) {
    const workspaceId = client_1.workspaceContext.getStore() ?? client.getWorkspaceId();
    if (!workspaceId)
        return UNKNOWN_TARGET;
    try {
        const { workspaces } = await client.listWorkspaces();
        const found = workspaces.find((w) => w.id === workspaceId);
        if (!found)
            return { ...UNKNOWN_TARGET, workspaceId };
        // 🔒 **`kind === "link"`, ASKED POSITIVELY, NOT `!isStandardWorkspace(…)`**
        // (F-564, closed here 2026-09-02). The negation answered "container" for
        // ANY non-standard kind, and `20260920120000` mints a `personal` one for
        // every user at once — a shelf with one member, which the member-count
        // term below happens to exclude. **Correct by accident is not correct**:
        // the class exists because a PEER arrived, and only a link container has
        // peers. `containerKind`'s `default` arm keeps an unknown future kind out.
        const container = (0, workspace_directory_js_1.containerKind)(found) === "home channel";
        return {
            workspaceId,
            label: (0, narration_js_1.inlineOr)(found.name, "`(unnamed workspace)`"),
            // ⚠ SHARED, NOT SOLO, and `?? 0` is NOT SOLO. A one-member container is
            // the operator's own agent surface with no second audience in it; the
            // class exists because a PEER arrived.
            sharedContainer: container && (found.memberCount ?? 0) !== 1,
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
/**
 * ⚠ A TOKEN ON A CALL THAT IS NOT IN THE CONFIRM CLASS IS REFUSED, not ignored.
 * The house rule is that an unknown argument is refused rather than stripped
 * (`registrar.ts › strictInput`), and the same reasoning applies one level up: a
 * caller echoing a token into a private create has mis-modelled the surface, and
 * silently accepting it teaches the wrong shape.
 */
function refuseStrayToken(tool, op) {
    return (0, respond_js_1.err)(`\`confirm_token\` was passed to ${tool} op="${op}", but this call is not audience-changing — it creates something only you can see, so there is no preview to confirm and nothing was created. Re-issue WITHOUT \`confirm_token\`. Tokens are only ever minted for a write that publishes into a shared home channel.`);
}
/**
 * 🔒 **THE SERVER'S OWN REFUSAL, MADE LEGIBLE — 400
 * `CONTAINER_PUBLISH_UNACKNOWLEDGED`** (G16;
 * `src/features/workspaces/server/shared-publish.ts`).
 *
 * ⚠ DUCK-TYPED ON THE STATUS AND THE CODE, never on an error class: no server
 * error type crosses this package boundary, which is the shape
 * `shelf.ts › homeShelfForbidden` established and `knowledge-ops-write.ts ›
 * agentCreateForbidden` repeated.
 *
 * ⚠ **THE REMEDY IS THE CALLER'S TO SUPPLY, BECAUSE IT DIFFERS BY OP.** On a
 * previewed op this refusal can only be a RACE — the room gained a member
 * between the preview and the act — and the fix is a fresh preview. On an op
 * with no preview step it is the ordinary answer, and the fix is a human. One
 * message for both would be wrong for both.
 */
function containerPublishUnacknowledged(e, remedy) {
    if (typeof e !== "object" || e === null)
        return null;
    if (e.status !== 400)
        return null;
    if (e.code !== "CONTAINER_PUBLISH_UNACKNOWLEDGED") {
        return null;
    }
    return (0, respond_js_1.err)(`Nothing was written. This would publish into a home channel somebody ELSE is standing in, and the server requires that the audience change be acknowledged. ${remedy}`);
}
/** The remedy for an op that HAS a preview step: this refusal means the room
 *  changed under the token, so the answer is to look again. */
exports.RECONFIRM_REMEDY = `Re-issue the SAME call WITHOUT \`confirm_token\` to get a fresh preview of who would see it, then confirm THAT one.`;
/**
 * THE GATE. Call it after the local contradiction refusals and before the
 * client write.
 *
 *   - not publishing, no token   → proceed
 *   - not publishing, with token → refuse (stray token)
 *   - publishing, not a shared container → proceed (nobody else is in the room)
 *   - publishing into a shared container, no token → PRECHECK, then PREVIEW + a
 *     fresh token — or the precheck's refusal, and NO token
 *   - publishing into a shared container, token    → verify, then proceed
 *     WITH `acknowledgedShared: true` — which the caller must put on the write
 *     body as `acknowledgeShared`, or the server refuses it (G16).
 *
 * 🔒 **`precheck` — A PREVIEW MUST NEVER ISSUE A TOKEN FOR AN ACT THE CONFIRMED
 * CALL WOULD REFUSE** (task 11, the pin the create side shipped without).
 *
 * ⚠ **THE HOLE IT CLOSES WAS LIVE AND WAS OBSERVED.** `dopl_kb
 * op="create_base" visibility="public"` in a shared home channel previewed,
 * handed back a `confirm_token`, and the echoed call was then refused by the
 * server's create gate. Everything in this module is decided from what THIS
 * process can see — the room's kind and its member count — and the gates that
 * actually refuse live in the server, so the preview was confidently describing
 * an act that could not happen. A token for an impossible act is worse than no
 * preview: the caller reads "re-issue with this token" as permission.
 *
 * ⚠ **IT IS THE CALLER'S CALLBACK BECAUSE THE GATE IS THE CALLER'S**, and this
 * module must not learn what a knowledge base is. `knowledge-ops-write.ts`
 * passes one that asks the SERVER to run the create's own gate chain with the
 * body the confirmed call will send (`dryRunKbBase`), so parity is the server's
 * one function rather than a rule two processes both promise to keep.
 *
 * ⚠ **IT RUNS ONLY WHERE A TOKEN WOULD BE MINTED.** Not on the private arm, not
 * in a standard workspace, and not on the confirm echo — where the real call
 * runs the real gate a moment later and refuses honestly on its own. So an
 * ordinary create pays nothing for it.
 *
 * ⚠ **IT REFUSES, IT NEVER PROCEEDS.** Returning a response halts; returning
 * `null` means "no objection", which is the only thing a precheck may say in
 * the permissive direction. It cannot mint, cannot spend and cannot widen the
 * class — an act that is not audience-changing never reaches it.
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
        // 🔒 ASK BEFORE PROMISING. ⚠ BEFORE `mint`, not after: a token minted and
        // then discarded is still a row in the store, and — the part that matters —
        // the preview text is built FROM the token, so any order but this one has
        // already written the sentence that lies.
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
/**
 * THE DRY RUN. ⚠ `isError`, deliberately: NOTHING was created, and an `ok`
 * result reading as a normal outcome invites an agent to report success — the
 * same reasoning `channel-ops-launch.ts › ambiguousTemplate` states for its own
 * refusal.
 */
function preview(act, target, token) {
    return (0, respond_js_1.err)([
        `NOTHING WAS CREATED — this is a dry run. ${act.tool} op="${act.op}" would publish into a home channel somebody ELSE is in, so it previews first.`,
        "",
        `**What would be created:** ${act.what}`,
        // ⚠ ONE NOUN FOR THE ROOM. Both arms said "home channel" and "workspace"
        // about the SAME object, in the one line a reader uses to decide whether
        // to go ahead — and "the workspace could not be read" invites the reader
        // to go looking for a workspace that was never the subject.
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
/** ⚠ TEST-ONLY. Nothing in the server calls it; the store is process-lifetime
 *  state and a suite that cannot clear it tests the previous suite's leftovers. */
function __resetConfirmTokensForTest() {
    TOKENS.clear();
}
