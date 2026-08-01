/**
 * SHARED HARNESS — the multiplayer `dopl_channel` op suites.
 *
 * Two suites read this one channel: `channel-ops-agents.test.ts` (the AGENT ROW
 * — agents / summon_agent / rename_agent / set_agent_status / disengage_agent)
 * and `channel-ops-participants.test.ts` (the PARTICIPANT SET — join_thread /
 * leave_thread). They were one file until it passed the §2 500-line cap.
 *
 * Extracted rather than copied because the roster shape is load-bearing on both
 * sides and in a way that is easy to break silently: ONYX is `parked` and owned
 * by someone else, which is what makes the roster render two statuses, what
 * makes the owner-only refusals reachable, and what makes a leave_thread name a
 * PEER's agent rather than the caller's own. A private second copy that quietly
 * marks Onyx active leaves both suites still green and testing less.
 *
 * Not a `.test.ts` file (vitest would find no tests in it), and deliberately
 * NOT named `channel-*`: `toolGroupFiles` in `tool-group-files.ts` groups every
 * non-test `channel-*.ts` as CHANNEL TOOL SOURCE, so that prefix would feed
 * this harness into the parity and await-cap source scans as if it shipped.
 * Same reason `narration-fixtures.ts` carries no tool stem.
 */
import type { DoplClient } from "@dopl/client";
export declare const CHANNEL: {
    id: string;
    slug: string;
    name: string;
    visibility: string;
};
export declare const QUARTZ: {
    id: string;
    channelId: string;
    workspaceId: string;
    ownerUserId: string;
    name: string;
    status: string;
    createdAt: string;
    updatedAt: string;
};
export declare const ONYX: {
    id: string;
    ownerUserId: string;
    name: string;
    status: string;
    channelId: string;
    workspaceId: string;
    createdAt: string;
    updatedAt: string;
};
export declare const BOB: {
    userId: string;
    email: string;
    displayName: string;
    status: string;
};
export declare function stubClient(overrides?: Record<string, unknown>): DoplClient;
/** An HTTP-shaped rejection, duck-typed exactly like @dopl/client's errors. */
export declare function apiError(status: number, code?: string): unknown;
export declare const textOf: (res: Promise<{
    content: Array<{
        text: string;
    }>;
}>) => Promise<string>;
