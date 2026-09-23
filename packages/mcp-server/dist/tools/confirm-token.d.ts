/**
 * The confirm class: a dry-run preview plus an opaque server-minted token the acting call must echo back.
 * A tripwire, not a fence, for publishing into a container other people stand in (any second member, whatever the
 * kind — F-513): it proves the agent SAW the act, not that a human approved it. What refuses is the server
 * (credential lock, audience ceiling in `service-audience.ts`, and `shared-publish.ts`'s 400).
 * The store is module-scoped (the server boots per request); an unknown token refuses, so a lost store means "preview again".
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond.js";
/** What the gate knows about the workspace a call resolved to. `unknown` fails closed (treated as shared). */
export interface ConfirmTarget {
    workspaceId: string | null;
    /** Neutralized display name, or a fallback. */
    label: string;
    /** Any container with more than one active member, whatever the kind. */
    sharedContainer: boolean;
    unknown: boolean;
}
/** Resolves the workspace this call landed in — the per-call ALS override first, then the session default. */
export declare function resolveConfirmTarget(client: DoplClient): Promise<ConfirmTarget>;
export interface ConfirmAct {
    tool: string;
    op: string;
    callerUserId: string | null;
    /** One line naming what will exist afterwards. Values must be neutralized. */
    what: string;
    /** Who will be able to see it. Values must be neutralized. */
    audience: string;
    /** Every field that decides what lands and who sees it; one left out can change between preview and act. */
    payload: Record<string, unknown>;
}
/** `acknowledgedShared` is true only when a token was spent on this act; the caller sends it as `acknowledgeShared`. */
export type ConfirmVerdict = {
    kind: "proceed";
    acknowledgedShared: boolean;
} | {
    kind: "halt";
    response: ToolResponse;
};
/** A token on a call outside the confirm class is refused, not ignored (as `registrar.ts › strictInput` does). */
export declare function refuseStrayToken(tool: string, op: string): ToolResponse;
/** Maps the server's 400 `CONTAINER_PUBLISH_UNACKNOWLEDGED`; the remedy is the caller's because it differs by op. */
export declare function containerPublishUnacknowledged(e: unknown, remedy: string): ToolResponse | null;
/** For a previewed op, that 400 means the room changed under the token, so the remedy is a fresh preview. */
export declare const RECONFIRM_REMEDY = "Re-issue the SAME call WITHOUT `confirm_token` to get a fresh preview of who would see it, then confirm THAT one.";
/**
 * The gate: call after local refusals, before the client write. Not publishing or a solo room proceeds (a stray token
 * is refused); a shared room with no token runs `precheck`, then previews with a fresh token; with a token it verifies
 * and proceeds with `acknowledgedShared: true`.
 */
export declare function confirmGate(client: DoplClient, act: ConfirmAct, opts: {
    publishes: boolean;
    token?: string;
    /** Asked once, right before minting: a response halts, `null` previews. A throw propagates — "could not check"
     *  must never mint a token for an act the confirmed call would refuse. */
    precheck?: () => Promise<ToolResponse | null>;
}): Promise<ConfirmVerdict>;
/** Test-only: clears the process-lifetime store. */
export declare function __resetConfirmTokensForTest(): void;
