/**
 * `dopl_channel` op="manage" action="launch" — asks the operator's own desktop to start an agent.
 * This op asks, it starts nothing: a refusal is a normal answer, and the HOLD timing out is not the
 * DIRECTIVE expiring (re-issuing without the same `client_msg_id` queues a second agent).
 * ⚠ **AND A HOLD THAT TIMED OUT UNCLAIMED IS NOT A NON-EVENT EITHER** — it was reported as one
 * until 2026-10-11. The hold's cap is 30s and `LAUNCH_DIRECTIVE_TTL_MS` is 120s, so an unclaimed
 * row is handed back 90s before it dies, expiry is computed at READ time with no cron, and nothing
 * ever reports it: a caller told `retry=no` over that row waits forever on a request that is
 * already dead on arrival. The pending branch below says so, and names the instant.
 * A directive is not a message (no `seq`, INVARIANTS §5), so the op holds on the row (`holdRow`).
 * `channel-` filename prefix is required by the parity split-scan (`tool-group-files.ts`).
 */
import type { AgentColorKey, DoplClient, LaunchMessageMode, LaunchToolMode } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * Ask for an agent, then hold briefly for the answer.
 * TERMINAL shapes: offline (nothing filed), launched, refused (reason + `retry=`), expired.
 * NON-TERMINAL, and they are two different answers: `claimed` (a machine has it, a decision is
 * imminent) and `pending` (nobody has it, and it lapses unannounced at `expires=`).
 */
export declare function opLaunchAgent(client: DoplClient, ref: string, opts?: {
    thread?: string;
    goal?: string;
    model?: string;
    /** The runtime (adapter); a separate field from `model`, neither derived from the other. */
    runtime?: string;
    /** Identity id or exact name; disambiguation and visibility are checked server-side. */
    identity?: string;
    /** Asked for, never set: the operator's machine clamps each axis to its own ceiling. */
    tools?: LaunchToolMode;
    messages?: LaunchMessageMode;
    /** Refused (not clamped) when the channel forbids it; omitted is not `false`. */
    chain?: boolean;
    /** Idempotency key: a repeat on `(channel, operator)` returns the stored directive. */
    clientMsgId?: string;
    /** Refused, never substituted, when taken; omitted means the most distinct free key. */
    color?: AgentColorKey;
    /** Required; optional in the type because it arrives as unvalidated JSON and `launchName` refuses it. */
    name?: string;
    waitMs?: number;
}): Promise<ToolResponse>;
/** One `details.matches` row; each already passed the caller's `canSeeIdentity`, so listing it is not an oracle. */
type IdentityMatch = {
    id: string;
    name: string;
    visibility: string;
};
/**
 * Lists the matches and never picks: identity names are deliberately not unique (a unique index would
 * leak private rows). `err`, because nothing was filed.
 */
export declare function launchIdentityAmbiguous(ref: string, matches: IdentityMatch[]): ToolResponse;
export {};
