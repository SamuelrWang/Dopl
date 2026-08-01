/**
 * SHARED HARNESS — the agent-addressing suites.
 *
 * Two suites read this one channel: `channel-agent-addressing.test.ts` (what a
 * POST addresses — `to_agent` / `as_agent` / `to_agents` / `intent`) and
 * `channel-thread-participants.test.ts` (who is admitted to a THREAD — the
 * `create_thread` seed and the set `get_thread` renders). They were one file
 * until it passed the §2 500-line cap.
 *
 * Extracted rather than copied because both halves depend on the SAME
 * asymmetry: the CHANNEL roster is a strict subset of the WORKSPACE roster
 * (Dale is only in the workspace), which is precisely the B2 case one half
 * pins and the other half must not quietly relax. Two private copies is how
 * one of them grows a Dale who is also a channel member and stops testing
 * anything.
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
/** Bob's agent — the one this caller may ADDRESS but may never speak AS. */
export declare const ONYX: {
    id: string;
    ownerUserId: string;
    name: string;
    channelId: string;
    workspaceId: string;
    status: string;
    createdAt: string;
    updatedAt: string;
};
export declare const BOB: {
    userId: string;
    email: string;
    displayName: string;
    status: string;
};
export declare const CARA: {
    userId: string;
    email: string;
    displayName: string;
    status: string;
};
/** In the WORKSPACE, not in the channel — the B2 case, and the common one. */
export declare const DALE: {
    userId: string;
    email: string;
    displayName: string;
    status: string;
};
export declare function stubClient(overrides?: Record<string, unknown>): DoplClient;
export declare function apiError(status: number, code?: string): unknown;
export declare const textOf: (res: {
    content: Array<{
        text: string;
    }>;
}) => string;
