"use strict";
/**
 * `dopl_status` — **THE ORCHESTRATOR'S CHECK-IN, IN ONE CALL** (T20).
 *
 * Every channel the caller is a member of — across every workspace AND every
 * home-channel container — with its tenancy handle, its high-water seq, unread
 * past a caller-supplied cursor, the caller's own live sessions in it, and what
 * is addressed to the caller and unanswered.
 *
 * ── WHY IT IS A TOOL AND NOT A `dopl_channel` OP ───────────────────────────
 *
 * ⚠ **IT IS A META TOOL, AND THAT IS THE WHOLE REASON IT WORKS FOR THE CALLER IT
 * IS FOR.** The domain path (`registrar.ts › registerTool`) injects a
 * `workspace=` argument and REFUSES a no-arg call from a caller with 0 or 2+
 * standard memberships — which is exactly the orchestrator this answers for. A
 * `workspace=` on this tool could only ever be wrong, because the question spans
 * every workspace at once; that is `dopl_home`'s argument for the same
 * placement, reached from the other direction.
 *
 * ⚠ **CHARGED, like `dopl_home` and unlike the two orientation tools** (Samuel's
 * ruling Q2 (b) applied): `current_workspace` / `list_workspaces` are how a lost
 * agent finds out where it is and are metered nowhere; this reads
 * content-adjacent data — names, previews, telemetry — across the account, so it
 * pays like a domain tool. The charge is written explicitly in
 * `registrar.ts › registerMetaTool`, opt-in per tool.
 *
 * 🔒 **THE CONTAINER LOCK IS APPLIED, AND NOT HERE.** `tools/account-scope.ts`
 * is the seam, and it delegates to the one reader of the lock
 * (`home-scopes.ts › narrowToLock`). Calling `client.getAccountStatus()` from
 * this file would hand a locked session the ids and names of its operator's
 * other rooms — the enumeration oracle B3 exists to deny.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerStatusTool = registerStatusTool;
const zod_1 = require("zod");
const respond_js_1 = require("./respond.js");
const account_scope_js_1 = require("./account-scope.js");
const status_render_js_1 = require("./status-render.js");
const STATUS_DESCRIPTION = `YOUR WHOLE PICTURE IN ONE CALL — every channel you are a member of, in every workspace AND every home channel, with what has moved in it and what is running in it. This is the check-in an orchestrator opens with; it replaces listing workspaces, then channels, then sessions, one call at a time.

Each row carries: the channel's name, the \`workspace=\` handle that reaches it from every other tool (a home channel's CONTAINER id appears here and in dopl_home and NOWHERE else), the \`channel=\` slug dopl_channel takes, how many messages arrived past the cursor you passed, and the highest seq in the room. Under it: each of YOUR OWN live agent sessions there with its addressable \`@agent-<id>\` handle and what it is doing, and each message ADDRESSED TO YOU that you have not answered.

Optional: since (a global \`seq\` cursor — pass the highest seq you have processed anywhere, and every "new" count is measured from it; omit it and the counts read "no cursor" rather than 0). \`seq\` is one sequence across the whole product, so ONE number really does cover every room.

⚠ IT DOES NOT WAIT. It is a snapshot, not a hold — to be woken by a new message, use dopl_channel(op="await", since=…). ⚠ IT SHOWS YOUR OWN SESSIONS ONLY; a peer's agent is visible to you only through what it posts. ⚠ "Waiting on you" means a message was addressed to you and you have posted nothing LATER in that room — there is no reply link on a message, so it over-reports rather than under-reports, and a thing you answered elsewhere may still be listed.`;
function registerStatusTool(registerMetaTool, client, directory) {
    registerMetaTool("dopl_status", STATUS_DESCRIPTION, {
        // ⚠ coerce: MCP clients sometimes send numbers as strings, which strict
        // z.number() rejects with an opaque -32602.
        since: zod_1.z.coerce
            .number()
            .int()
            .min(0)
            .optional()
            .describe('A global `seq` cursor — the highest seq you have already processed, ANYWHERE. `seq` is one sequence across every channel of every workspace, so a single number covers them all. Omitted, every "new" count reads "no cursor": absent is NOT zero, and nothing here will claim a room is quiet when you never asked.'),
    }, async (args) => {
        const status = await (0, account_scope_js_1.accountStatus)(client, directory, {
            since: args.since,
        });
        return (0, respond_js_1.ok)((0, status_render_js_1.statusLines)(status).join("\n"));
    }, 
    // ⚠ CHARGED — see this file's header and `registrar.ts › registerMetaTool`.
    { charged: true });
}
