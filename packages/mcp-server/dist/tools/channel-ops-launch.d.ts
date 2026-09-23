/**
 * `dopl_channel` op="manage" action="launch" — asks the operator's own desktop to start an agent.
 * This op asks, it starts nothing: a refusal is a normal answer, and a timeout is not a failure
 * (re-issuing without the same `client_msg_id` queues a second agent).
 * A directive is not a message (no `seq`, INVARIANTS §5), so the op holds on the row (`holdRow`).
 * `channel-` filename prefix is required by the parity split-scan (`tool-group-files.ts`).
 */
import type { AgentColorKey, DoplClient, LaunchMessageMode, LaunchToolMode } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * Ask for an agent, then hold briefly for the answer.
 * Terminal shapes: offline (nothing filed), launched, refused (reason + `retry=`), pending / expired.
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
    /** Refused, never substituted, when taken; omitted means first free. */
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
export declare function identityMatches(e: unknown): IdentityMatch[];
/**
 * Lists the matches and never picks: identity names are deliberately not unique (a unique index would
 * leak private rows). `err`, because nothing was filed.
 */
export declare function launchIdentityAmbiguous(ref: string, matches: IdentityMatch[]): ToolResponse;
/** `details.elsewhere`: an identity the caller holds in another of their own tenancies; duck-typed. */
type IdentityElsewhere = {
    name: string;
    label: string;
};
export declare function identityElsewhere(e: unknown): IdentityElsewhere | null;
/**
 * The caller's own visibility failing at create time (`no-identity` is the operator's, after filing).
 * Never says whether the identity exists (404-never-403). A NAME resolves only in the channel's
 * container, while an ID resolves wherever it lives (`src/features/agent-identities/server/service-resolve-ref.ts ›
 * resolveIdentityRef`); `details.elsewhere` is fenced by `classifyMissingIdentityRef` to identities the caller could already list.
 */
export declare function launchIdentityNotFound(ref: string, elsewhere: IdentityElsewhere | null): ToolResponse;
export {};
