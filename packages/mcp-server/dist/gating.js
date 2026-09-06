"use strict";
/**
 * gating.ts — THE GATES, and the tables they read.
 *
 * ⚠ THE TOPOLOGY IS THE INVARIANT. Gates run at REGISTRATION (the tool never
 * exists) or per CALL (the op is refused):
 *
 *   registration → {@link Gates.isSuppressedTool}: HIDDEN_TOOLS, plus the
 *                  profile-scoped offer `X-Dopl-Tool-Profile` reports.
 *   per call     → {@link Gates.opRefusal}: the app-only-deletion block FIRST
 *                  and unconditionally, then the write-scope gate.
 *
 * ⚠ They live HERE, outside the registration wrapper, because
 * `registerMetaTool` registers straight onto the SDK server — inline gating
 * published two tools that passed through none of them. Do NOT push these back
 * inside a wrapper; both registration helpers call them explicitly.
 *
 * ⚠ ORDERING INSIDE `opRefusal` IS LOAD-BEARING: the delete refusal fires
 * first and unconditionally, before workspace resolution and any client call,
 * so a refused delete costs zero round trips and can never half-happen. It must
 * never become reachable only after another gate lets the call through.
 *
 * ⚠ `READ_ONLY_BLOCKED_TOOLS` WAS DELETED WITH THE FIVE `_admin` TOOLS
 * (2026-09-02). It held exactly those five names — the purely destructive tools
 * a read-only session was not even offered — and nothing can join it: deletion
 * is app-only, so no destructive tool can be registered for it to name. A
 * read-only session's write refusal is {@link WRITE_OPS}, per op, which is where
 * it always was for every mixed tool.
 *
 * ⚠ `parity.test.ts` / `delete-block.test.ts` PARSE `WRITE_OPS` and
 * `HIDDEN_TOOLS` out of this file's SOURCE TEXT (`tools/parity-harness.ts`).
 * The parse follows the constant, not the filename.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WRITE_OPS = exports.NARROWEST_TOOL_PROFILE = exports.TOOL_PROFILES = exports.HIDDEN_TOOLS = void 0;
exports.offeredToolsFor = offeredToolsFor;
exports.isWriteOp = isWriteOp;
exports.createGates = createGates;
const delete_policy_js_1 = require("./delete-policy.js");
const tool_errors_js_1 = require("./tools/tool-errors.js");
/**
 * THE HIDE-BEFORE-DELETE SEAM — a registered tool an agent no longer sees.
 * Empty is the current state, not a dead mechanism: retirement is two steps
 * (hide, then delete), and this is step one's whole implementation.
 *
 * ⚠ A tool that no longer EXISTS must not be listed here —
 * `delete-block.test.ts` asserts every HIDDEN name still has a registrar, and a
 * name with none is a claim about a gate that guards nothing.
 *
 * ⚠ At the REGISTRAR, not the route: the MCP server reaches the app's routes
 * over LOOPBACK HTTP through `DoplClient`, so gating a route 500s the tool while
 * the agent still SEES it in `tools/list`. Unregistered = absent = nothing to
 * call. Same choke point as `READ_ONLY_BLOCKED_TOOLS` below.
 */
exports.HIDDEN_TOOLS = new Set([]);
/**
 * THE SESSION PROFILES THE HEADER MAY NAME — the four CONTAINMENT profiles the
 * desktop already spawns sessions under (`dopl-desktop-app/main/tool-profiles.js
 * › KNOWN_PROFILES`), carried on the wire by `X-Dopl-Tool-Profile`.
 *
 * ⚠ A PROFILE SAYS HOW MUCH OF THE MACHINE A SESSION MAY TOUCH, AND NOTHING
 * ABOUT WHAT IT IS FOR. There is no table here keyed on what one operator's
 * sessions do for each other: one account runs many sessions that direct each
 * other, another runs a single one, and neither arrangement is a product
 * concept every connection should pay to be told about.
 * `tool-profile.test.ts` pins this list as a VALUE and scans the served text,
 * so a name of that kind cannot enter the surface through this file.
 *
 * ⚠ ORDERED NARROWEST FIRST. The head is {@link NARROWEST_TOOL_PROFILE}, the
 * answer for every value this server cannot place.
 */
exports.TOOL_PROFILES = [
    "read_only",
    "dopl_only",
    "channel_agent",
    "full",
];
/**
 * THE FLOOR, AND THE ANSWER TO EVERY UNRECOGNIZED CLAIM — an unknown name, a
 * near-miss, or a header carrying two different values
 * (`src/shared/auth/tool-profile-header.ts`).
 *
 * ⚠ FAIL CLOSED, matching the desktop's own `normalizeProfile`: the header
 * carries the profile a session is ALREADY contained at, so a value this server
 * cannot place describes a containment it does not know, and the only offer that
 * cannot be wider than the truth is the narrowest one.
 *
 * ⚠ AN ABSENT HEADER IS NOT AN UNRECOGNIZED ONE. No claim is no narrowing —
 * which is what keeps every client that sends nothing (the OAuth connector, the
 * stdio binary, an older desktop) on the whole surface.
 */
exports.NARROWEST_TOOL_PROFILE = exports.TOOL_PROFILES[0];
/**
 * `dopl_only`'s offer: every tool this server registers EXCEPT `dopl_channel`.
 *
 * ⚠ IT IS THE DESKTOP'S OWN ALLOW LIST (`tool-profiles.js › DOPL_SAFE_TOOLS`,
 * which `dopl-desktop-app/test/tool-profiles.test.mjs` holds equal to this
 * server's live registrations). A `dopl_only` session pre-approves exactly these
 * and DENIES `dopl_channel` by name, so serving it would be publishing a tool
 * the machine refuses — the offer may never be wider than the deny list.
 *
 * ⚠ AN ALLOW LIST, NOT AN EXCLUSION, for the reason that file gives: a tool
 * registered tomorrow must be CLASSIFIED before a contained session is offered
 * it. `tool-profile.test.ts` asserts every name here is live and that the set is
 * the whole surface minus the one exclusion, so neither half can rot silently.
 */
const DOPL_ONLY_TOOLS = new Set([
    "dopl_kb",
    "dopl_search",
    "dopl_map",
    "dopl_members",
    "dopl_skill",
    "dopl_ontology",
    "dopl_chats",
    "dopl_agent",
    "dopl_status",
    "dopl_workspaces",
]);
/**
 * PROFILE → THE TOOLS IT IS OFFERED. `null` is the whole surface.
 *
 * ⚠ NARROWING-ONLY BY CONSTRUCTION, in three ways that must all stay true:
 *   1. a row is an ALLOW set INTERSECTED with what the registrars register, so
 *      no row can name a tool into existence — a stale name loses a tool and
 *      can never invent one;
 *   2. no row is wider than the deny list the machine already applies to that
 *      profile, because the header reports containment that has ALREADY been
 *      decided (`loader.js › withToolProfileStamp` stamps `normalizeProfile`'s
 *      answer, never a request);
 *   3. it is a HINT AND NOT A FENCE. The value is caller-supplied, so anything
 *      holding the credential can claim any profile. What REFUSES a call is the
 *      credential, the desktop's `disallowedTools` + `grantDecision`, and
 *      {@link WRITE_OPS}. Nothing may be GRANTED on this value. Same discipline
 *      as `src/shared/auth/runtime-header.ts`.
 *
 * ⚠ A `Record` KEYED BY {@link ToolProfile}, so the compiler proves it TOTAL: a
 * profile added to the vocabulary with no row is a build error rather than a
 * silent widening. Indexing it with a wire value is safe only because
 * {@link normalizeToolProfile} resolves that value against the vocabulary FIRST
 * — `"constructor"` becomes {@link NARROWEST_TOOL_PROFILE} before any lookup, so
 * no key off the wire ever reaches this object.
 */
const PROFILE_TOOLS = {
    // ZERO-OUTBOUND. The machine denies this session the whole `mcp__dopl` server
    // prefix, so the honest offer is nothing at all — and it is the largest saving
    // on the surface, because a session that is offered no tool pays for no
    // description and no input schema either.
    read_only: new Set([]),
    dopl_only: DOPL_ONLY_TOOLS,
    // `full` minus `Bash` — a distinction in BUILT-INs, which this server does not
    // serve, so on this surface it is `full`.
    channel_agent: null,
    full: null,
};
/**
 * The vocabulary check, and the ONE place an unrecognized claim falls to the
 * floor. ⚠ Never exported: a second caller normalizing on its own is the
 * hand-mirror this file exists to prevent.
 */
function normalizeToolProfile(claimed) {
    return exports.TOOL_PROFILES.includes(claimed)
        ? claimed
        : exports.NARROWEST_TOOL_PROFILE;
}
/**
 * The tools this session is offered, or `null` for "no narrowing". ⚠ THE ONE
 * PLACE A PROFILE BECOMES A SET, so both directions are written once:
 * `undefined`/`null` is NO CLAIM and serves everything, while ANY string is a
 * claim — narrowed to its row, or to the narrowest profile's row when this
 * server cannot place it. ⚠ The absence test is on the TYPE, not on
 * truthiness: `""` is a claim this server could not read
 * (`tool-profile-header.ts › UNREADABLE_TOOL_PROFILE`), and falling through a
 * `!claimed` check would serve it the whole surface — the one direction this
 * value may never fail.
 */
function offeredToolsFor(claimed) {
    if (typeof claimed !== "string")
        return null;
    return PROFILE_TOOLS[normalizeToolProfile(claimed)];
}
/**
 * Per-op write gating for MIXED read+write tools — they stay registered for
 * read-only sessions so reads work, but write ops are refused. ⚠ Keep each set
 * in sync with the tool's `op` enum: a new write op MUST be added here, or a
 * `dopl.read`-only token can write through a non-admin tool.
 */
exports.WRITE_OPS = {
    dopl_ontology: new Set([
        "create_cluster",
        "update_cluster",
        "create_column",
        "create_object",
        "update_object",
        "set_template_field",
        "remove_template_field",
        "set_attribute",
        "remove_attribute",
        "set_relationship",
        "remove_relationship",
        "set_action",
        "remove_action",
        "claim_anchor",
    ]),
    dopl_kb: new Set([
        "create_base",
        "update_base",
        "create_folder",
        "move_folder",
        "write_file",
        "move_file",
        "set_visibility",
        // ⚠ `pin` and `unpin` WRITE, and UNPIN is the one easiest to wave through:
        // both set a WORKSPACE-WIDE boolean deciding what every agent session
        // launched here is handed at startup, so a read-only token must be refused
        // both or a dopl.read session can silently empty its operator's launch
        // context through a non-admin tool.
        // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: the parity harness parses this set out
        // of the SOURCE TEXT, so a quoted phrase in a comment is read as an op name.
        "pin",
        "unpin",
        // ⚠ grant LENDS THE BASE TO A SCOPE, so it is the widest write on this
        // tool — it changes who can READ the operator's knowledge — and a read-only
        // token must be refused it. ⚠ The refusal is the ONE that costs nothing:
        // the gate runs before the scope resolves and before any row is read.
        "grant",
    ]),
    dopl_skill: new Set([
        "create",
        "update",
        "write",
        "set_visibility",
    ]),
    // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: `tools/parity-harness.ts` parses this set
    // out of the SOURCE TEXT, so a quoted phrase in a comment is read as an op
    // name and fails the WRITE_OPS-subset-of-enum check.
    // ⚠ BOTH verbs write, and update is the one easiest to miss: it can raise a
    // template to workspace visibility, which is the SHARE act itself (a template
    // has no grant table). A read-only token must be refused it.
    // ⚠ grant LENDS THE TEMPLATE TO A SCOPE — the SHARE act by another door, and
    // the widest write here for the same reason `dopl_kb`'s is.
    dopl_agent: new Set(["create", "update", "grant"]),
    dopl_chats: new Set(["export", "append", "update", "create_folder", "update_folder"]),
    // ⚠ `dopl_workspaces` REGISTERS ON THE META PATH AND IS STILL GATED HERE,
    // because `opRefusal` is called explicitly on BOTH registration paths — which
    // is the whole reason the gates were hoisted out of the domain wrapper. A
    // read-only token lists containers and mints none. ⚠ Its `op` is OPTIONAL and
    // defaults to the READ: `opRefusal` returns null for an ABSENT op, so a
    // write-by-default would be a write this table never sees (F-621).
    dopl_workspaces: new Set(["create_home_channel"]),
    // ⚠ **SEVEN ENTRIES OVER SIX OPS, AND TWO OF THE SIX ARE ABSENT** (v2 wave B
    // slice B8, 2026-09-02; `artifact` added 2026-09-06). `read` and `status` only
    // read. `send`, `manage` and `artifact` only write — the last two coarsely,
    // one entry each. `rooms` does BOTH, so it is gated PER ACTION — see
    // {@link isWriteOp} for the dotted key and for why a bare `rooms` fails
    // CLOSED. Classifying the whole op as a write would refuse a `dopl.read`
    // token the four calls it exists to make (list, members, threads, help);
    // classifying it as a read would hand one the four that change the room.
    // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: `tools/parity-harness.ts` parses this set
    // out of the SOURCE TEXT, so a quoted phrase in a comment is read as an op
    // name and fails the WRITE_OPS-subset-of-enum check.
    dopl_channel: new Set([
        // ⚠ `send` IS EVERY WRITE THAT REACHES A ROOM — an ordinary message, a
        // milestone marker, a decision card, and the thread a message opens. Each
        // was its own op and its own entry here; each wrote a real message row in a
        // room every member reads, which is the SCOPE reason a read-only token is
        // refused it, and none of them ever depended on the payload being
        // structured.
        "send",
        // ⚠ `manage` ASKS A MACHINE TO ACT. It files a `channel_launch_directives`
        // or `channel_agent_directions` row and asks the operator's own machine to
        // start, stop, relabel, re-permission or interrupt a process. ⚠ CLASSIFIED
        // AS A WRITE EVEN THOUGH RENAME CHANGES NO ROW A READ COULD SEE — an end
        // mutates a live process and a rename mutates a local store, and neither is
        // a read that happens to wait. A read-only session must not stop, widen or
        // steer its operator's agents through a non-admin tool.
        "manage",
        // ⚠ THE FOUR ROOM WRITES, EACH NAMED. `update` is the one easiest to wave
        // through: it also READS when `info_card` is omitted, and it is gated anyway
        // — an action that can write must be refused wholesale, or the read arm
        // becomes the door the write arm walks through.
        "rooms.open",
        "rooms.invite",
        "rooms.thread_mode",
        "rooms.update",
        // ⚠ `artifact` TAKES THE COARSE GRAIN, LIKE `manage` AND UNLIKE `rooms`,
        // because ALL FOUR of its actions write: create folds existing messages into
        // a new card, add and remove move a message across that card, and dissolve
        // retires it. There is no read action in the vocabulary
        // (`channel-schema.ts › CHANNEL_ACTIONS.artifact`), so a bare entry is the
        // honest statement rather than a shortcut — and it is the FAIL-CLOSED one: a
        // fifth action added tomorrow is refused to a read-only token until somebody
        // classifies it, instead of arriving as an un-gated write.
        // ⚠ NON-DESTRUCTIVE DOES NOT MEAN READ-ONLY, and dissolve is the one easiest
        // to wave through on that reasoning: it leaves every body, author and seq
        // where it was, which is why it sits inside the tool's no-delete policy — but
        // it still retires a card every member of the room sees, so a `dopl.read`
        // token must be refused it.
        "artifact",
    ]),
};
/**
 * Does `op` — the key {@link Gates.requestedOp} produced — write?
 *
 * ⚠ **TWO GRAINS, ON PURPOSE.** A bare entry (`manage`) gates the whole op; a
 * dotted one (`rooms.open`) gates one action and leaves its siblings readable.
 * `rooms` needs the fine grain — four of its actions read — and `manage` needs
 * the coarse one, because listing five actions that all write is five chances to
 * add a sixth and forget.
 *
 * ⚠ **THE BARE-CALL ARM FAILS CLOSED, AND THAT IS THE WHOLE REASON THIS IS A
 * FUNCTION.** A sub-actioned call arrives as `rooms.open`; a call that named NO
 * action arrives as bare `rooms`, and it must not read as "no matching write
 * entry, therefore a read". The handler refuses a missing `action` before any
 * write happens, so nothing is lost by refusing it here too — and refusing it
 * here is what keeps the gate's answer independent of a handler's discipline.
 *
 * ⚠ The scan is over ONE tool's set, at most a dozen short strings, on a path
 * that already does a `Set.has`. It is not worth an index.
 */
function isWriteOp(name, op) {
    const writes = exports.WRITE_OPS[name];
    if (!writes)
        return false;
    if (writes.has(op))
        return true;
    const dot = op.indexOf(".");
    // ⚠ A BARE ENTRY COVERS EVERY ACTION OF ITS OP, and that is not a shortcut: it
    // is how a table says "this whole op writes" once instead of five times, which
    // is the honest statement for `manage` and would be a lie for `rooms`.
    if (dot > 0)
        return writes.has(op.slice(0, dot));
    // ⚠ THE FAIL-CLOSED ARM: an op with WRITE actions, called with no action named.
    for (const entry of writes) {
        if (entry.startsWith(`${op}.`))
            return true;
    }
    return false;
}
/**
 * Build the gates for one session. ⚠ `canWrite` is the OAuth scope verdict and
 * FAILS CLOSED upstream — write only on an explicit `dopl.write`.
 *
 * ⚠ `offeredTools` is the RESOLVED set, not a profile name, so a caller can hand
 * in any set it likes — which is what lets `meta-gate.test.ts` drive the
 * suppression leg with synthetic names rather than through the real table.
 * `server.ts` resolves it through {@link offeredToolsFor}; `null` is "serve
 * everything", which is what a connection claiming no profile gets.
 */
function createGates(canWrite, offeredTools = null) {
    function isSuppressedTool(name) {
        if (exports.HIDDEN_TOOLS.has(name))
            return true;
        return offeredTools !== null && !offeredTools.has(name);
    }
    /**
     * The key a call is gated on: `<op>` for a plain dispatch tool, `<op>.<action>`
     * for one whose op carries a sub-verb.
     *
     * ⚠ **GENERIC, NOT `dopl_channel`-SPECIFIC**, and that is deliberate: this
     * function is the ONE place a call becomes a gate key, and a per-tool branch
     * here is a table nobody would find. No other tool declares an `action`, so
     * the composite arm is inert everywhere else — and if one grows the param, its
     * gate becomes finer rather than silently coarser.
     */
    function requestedOp(args) {
        const bag = args;
        const op = bag?.op;
        if (typeof op !== "string")
            return undefined;
        const action = bag?.action;
        return typeof action === "string" ? `${op}.${action}` : op;
    }
    function opRefusal(name, op) {
        if (op === undefined)
            return null;
        // ⚠ THE BASE OP, because {@link DELETE_BLOCKED_OPS} names ops that may never
        // appear in an op ENUM — a claim about the enum, which carries no action.
        if ((0, delete_policy_js_1.isBlockedDeleteOp)(name, op.split(".")[0])) {
            return {
                isError: true,
                content: [{ type: "text", text: delete_policy_js_1.DELETE_REFUSAL }],
            };
        }
        if (!canWrite && isWriteOp(name, op)) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        // ⚠ Same shape as every other refusal on this surface: the code
                        // first, so an agent has a literal to match, then the sentence that
                        // says which call was refused. `meta-gate.test.ts` pins "read-only".
                        text: (0, tool_errors_js_1.refusal)(tool_errors_js_1.READ_ONLY_SESSION, `\`${name}\` op="${op}" is a write operation. Reconnect with write access to perform it.`),
                    },
                ],
            };
        }
        return null;
    }
    return { isSuppressedTool, requestedOp, opRefusal };
}
