"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.textOf = exports.DALE = exports.CARA = exports.BOB = exports.ONYX = exports.QUARTZ = exports.CHANNEL = void 0;
exports.stubClient = stubClient;
exports.apiError = apiError;
const vitest_1 = require("vitest");
exports.CHANNEL = {
    id: "chan-1",
    slug: "general",
    name: "General",
    visibility: "private",
};
exports.QUARTZ = {
    id: "agent-1",
    channelId: "chan-1",
    workspaceId: "ws-1",
    ownerUserId: "u-me",
    name: "quartz",
    status: "active",
    createdAt: "2026-07-31T00:00:00Z",
    updatedAt: "2026-07-31T00:00:00Z",
};
/** Bob's agent — the one this caller may ADDRESS but may never speak AS. */
exports.ONYX = { ...exports.QUARTZ, id: "agent-2", ownerUserId: "u-bob", name: "onyx" };
exports.BOB = {
    userId: "u-bob",
    email: "bob@x.com",
    displayName: "Bob",
    status: "active",
};
exports.CARA = {
    userId: "u-cara",
    email: "cara@x.com",
    displayName: "Cara",
    status: "active",
};
/** In the WORKSPACE, not in the channel — the B2 case, and the common one. */
exports.DALE = {
    userId: "u-dale",
    email: "dale@x.com",
    displayName: "Dale",
    status: "active",
};
function stubClient(overrides = {}) {
    const postChannelMessage = vitest_1.vi.fn(async () => ({
        id: "m1",
        seq: 12,
        kind: "message",
        metadata: {},
        authorUserId: "u-me",
    }));
    return {
        listChannels: vitest_1.vi.fn(async () => [exports.CHANNEL]),
        listChannelAgents: vitest_1.vi.fn(async () => [exports.QUARTZ, exports.ONYX]),
        // The CHANNEL roster — a strict subset of the workspace. Dale is only in
        // the workspace, which is exactly the shape B2 is about.
        listChannelMembers: vitest_1.vi.fn(async () => [
            { userId: "u-me", displayName: "Me", email: "me@x.com", role: "owner" },
            { userId: "u-bob", displayName: "Bob", email: "bob@x.com", role: "member" },
            { userId: "u-cara", displayName: "Cara", email: "cara@x.com", role: "member" },
        ]),
        listWorkspaceMembers: vitest_1.vi.fn(async () => [exports.BOB, exports.CARA, exports.DALE]),
        listChannelThreads: vitest_1.vi.fn(async () => []),
        postChannelMessage,
        ...overrides,
    };
}
function apiError(status, code) {
    return Object.assign(new Error(`HTTP ${status}`), { status, code });
}
const textOf = (res) => res.content.map((c) => c.text).join("\n");
exports.textOf = textOf;
