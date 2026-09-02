/**
 * **THE RETIRED OP NAMES, AND THE ONE LINE EACH OF THEM ANSWERS WITH** (MCP v2
 * wave B slice B8, 2026-09-02 — Samuel's ruling B9).
 *
 * `dopl_channel` published 23 ops; it publishes FIVE. The other twenty-two names
 * still PARSE for one minor release and answer a single line naming their
 * replacement, so a caller pinned to an older desktop is told what to call
 * instead of receiving an opaque `-32602 invalid enum value`.
 *
 * ⚠ **THEY ARE HIDDEN FROM THE LIST, NOT PRESENT IN IT.** `channel-schema.ts`
 * builds `op` as `z.enum([...CHANNEL_OPS, ...RETIRED_OPS]).meta({ enum:
 * CHANNEL_OPS })`: the RUNTIME accepts twenty-seven words, the PUBLISHED JSON
 * Schema — the one the SDK renders through `z.toJSONSchema` and every client
 * reads — carries five. A retired name a model can SEE is a name a model will
 * call, and the whole point of the collapse is that the surface a model chooses
 * from is five words wide.
 *
 * ⚠ **ONE LINE, AND NOTHING ELSE.** No facts, no doctrine, no re-teaching of the
 * new op's arguments: the replacement is named with the shape that answers the
 * same question, and `rooms(action="help")` is where the rules live. A redirect
 * that explains is a redirect that gets read instead of followed.
 *
 * ⚠ **THIS FILE IS THE WHOLE OF THE COMPATIBILITY WINDOW.** Slice B16 deletes it
 * — the map, the type and the arm in `channel.ts` — one release after the
 * desktop version floor stops calling any of these names. Nothing else in the
 * tree may grow a second copy of the mapping; `channel-retired-ops.test.ts`
 * drives every row through the real registrar.
 *
 * ⚠ `channel-` filename prefix is REQUIRED: the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`law-scan.test.ts`) both walk every non-test `channel-*.ts` in this
 * directory, and this module ships strings.
 */
import { type ToolResponse } from "./respond";
/**
 * old name → the one line it answers with.
 *
 * ⚠ **`read` IS NOT HERE AND MUST NOT BE.** It is the one old name that SURVIVED
 * the collapse with its own meaning intact, so a redirect for it would refuse a
 * live op. `await` is here because the HOLD became a knob on `read` rather than
 * an op of its own.
 *
 * ⚠ **EVERY LINE NAMES THE ARGUMENT THAT MOVED**, because that is the half a
 * caller cannot guess: `ping` did not merely get a new spelling, its recipient
 * became `to=` and its delivery record became the send's own `delivery=`.
 */
export declare const RETIRED_OPS: {
    readonly post: "retired: use send — dopl_channel(op=\"send\", channel=…, body=…, to=…).";
    readonly milestone: "retired: use send(kind=\"milestone\") — same body, `thread` required, still one line.";
    readonly escalate: "retired: use send(kind=\"decision\") — `summary` is the question, `body` the context, `options` and `recommendation` unchanged.";
    readonly ping: "retired: use send(to=…) — a directed send IS the delivery record, and its `delivery=` is the ack the ping row used to be.";
    readonly pings: "retired: use read — a directed send lands in the transcript, so there is no second inbox to page.";
    readonly create_thread: "retired: use send(thread=\"new\", to=…, summary=<the title>) — the new thread id comes back on the result.";
    readonly list: "retired: use rooms(action=\"list\").";
    readonly open: "retired: use rooms(action=\"open\", name=…), or rooms(action=\"open\", to=<member>) for a 1:1.";
    readonly invite: "retired: use rooms(action=\"invite\", channel=…, to=…).";
    readonly members: "retired: use rooms(action=\"members\", channel=…).";
    readonly list_threads: "retired: use rooms(action=\"threads\", channel=…).";
    readonly set_thread_mode: "retired: use rooms(action=\"thread_mode\", channel=…, thread=…, mode=…).";
    readonly update: "retired: use rooms(action=\"update\", channel=…, info_card=…).";
    readonly help: "retired: use rooms(action=\"help\", section=…).";
    readonly await: "retired: use read(since=…, wait_ms=…) — the hold is a knob on the read, not an op of its own.";
    readonly launch_agent: "retired: use manage(action=\"launch\", channel=…).";
    readonly end_agent: "retired: use manage(action=\"end\", to=<the agent handle>).";
    readonly rename_agent: "retired: use manage(action=\"rename\", to=<the agent handle>, name=…).";
    readonly set_agent_mode: "retired: use manage(action=\"posture\", to=<the agent handle>, posture=…).";
    readonly direct_agent: "retired: use manage(action=\"direct\", to=<the agent handle>, body=…).";
    readonly read_directions: "retired: use status — it reads the whole state machine.";
    readonly read_sessions: "retired: use status — it reads the whole state machine.";
};
/** The twenty-two names that still parse but are absent from the published enum. */
export type RetiredOp = keyof typeof RETIRED_OPS;
/**
 * The published tuple, for `z.enum`'s non-empty-tuple overload. ⚠ Derived from
 * the map, never restated: a hand-written second list is how a name comes to
 * parse with no line to answer it, or to answer with a line nothing accepts.
 */
export declare const RETIRED_OP_NAMES: [RetiredOp, ...RetiredOp[]];
/** True for a name that parses only to be redirected. */
export declare function isRetiredOp(op: string): op is RetiredOp;
/**
 * The redirect, as an ordinary OK result.
 *
 * ⚠ **NOT `err()`, DELIBERATELY.** An `isError` response is a failure a model
 * retries; this call did not fail, it was answered — the caller asked a question
 * whose answer is the name of another op. An error would also put the line
 * behind whatever retry policy the client applies to failures, which is exactly
 * where a one-release migration notice must not be.
 */
export declare function retiredRedirect(op: RetiredOp): ToolResponse;
