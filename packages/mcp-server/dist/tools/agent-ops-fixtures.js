"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.textOf = exports.BOB = exports.ONYX = exports.QUARTZ = exports.CHANNEL = void 0;
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
exports.ONYX = {
    ...exports.QUARTZ,
    id: "agent-2",
    ownerUserId: "u-bob",
    name: "onyx",
    status: "parked",
};
exports.BOB = {
    userId: "u-bob",
    email: "bob@x.com",
    displayName: "Bob",
    status: "active",
};
function stubClient(overrides = {}) {
    return {
        listChannels: vitest_1.vi.fn(async () => [exports.CHANNEL]),
        listChannelMembers: vitest_1.vi.fn(async () => [
            { userId: "u-me", displayName: "Me", role: "owner" },
            { userId: "u-bob", displayName: "Bob", role: "member" },
        ]),
        listChannelAgents: vitest_1.vi.fn(async () => [exports.QUARTZ, exports.ONYX]),
        listWorkspaceMembers: vitest_1.vi.fn(async () => [exports.BOB]),
        ...overrides,
    };
}
/** An HTTP-shaped rejection, duck-typed exactly like @dopl/client's errors. */
function apiError(status, code) {
    return Object.assign(new Error(`HTTP ${status}`), { status, code });
}
const textOf = async (res) => (await res).content.map((c) => c.text).join("\n");
exports.textOf = textOf;
