import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository-sessions");
vi.mock("./repository-messages");
vi.mock("./repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repository")>()),
  findUnaddressedResponder: vi.fn(),
}));

import { projection, resolve, sessionRow, unaddressedResponder } from "./service-wake-verdict-harness";
import { CROSS_SCOPE_WAKE, offScopeAgentIds, postScope } from "./service-wake-verdict-reach";

/**
 * **THREAD MENTION REACH, STEP 1 — THE SERVER STOPS CLAIMING `woken` FOR AN AGENT ITS
 * DESKTOP CANNOT FEED** (2026-10-29; KB Audits/Thread Mention Reach Audit).
 *
 * Both directions: a THREAD post naming a main-room agent, and a MAIN-ROOM post naming a
 * thread-bound agent. And the negative claims: on-scope still `woken`, unknown stays `woken`,
 * a member named alongside still reached somebody.
 */

const T = "11111111-2222-4333-8444-555555555555";
const U = "99999999-2222-4333-8444-555555555555";
const ID = "k3v7d2mq";
// The integration cases below assert the rule's prediction under the CURRENT switch.
const OFF = CROSS_SCOPE_WAKE ? "woken" : "unreachable";
const mainRow = () => sessionRow({ session_key: `chan-1::${ID}`, thread_id: null, name: ID });
const threadRow = (t: string) => sessionRow({ session_key: `chan-1:${t}:${ID}`, thread_id: t, name: ID });

beforeEach(() => {
  vi.resetAllMocks();
  unaddressedResponder();
});

describe("postScope / offScopeAgentIds (pure)", () => {
  it("a uuid thread is its own scope; a legacy tag is the main room, as on the desktop", () => {
    expect(postScope({ threadId: T })).toBe(T);
    expect(postScope({ threadId: "thread-chan-1-4" })).toBe("");
    expect(postScope({})).toBe("");
  });

  it("no rows for an agent is UNKNOWN, never unreachable", () => {
    expect(offScopeAgentIds([], [ID], "chan-1", T)).toEqual([]);
    expect(offScopeAgentIds(undefined, [ID], "chan-1", T)).toEqual([]);
  });

  it("off-scope is found when the switch is off (explicit, whatever the build's value)", () => {
    expect(offScopeAgentIds([mainRow()], [ID], "chan-1", T, false)).toEqual([ID]);
    expect(offScopeAgentIds([threadRow(T)], [ID], "chan-1", T, false)).toEqual([]);
  });

  it("the cross-scope switch turns the rule off", () => {
    expect(offScopeAgentIds([mainRow()], [ID], "chan-1", T, true)).toEqual([]);
  });
});

describe("resolveWakeVerdict · reach (both directions)", () => {
  it("thread post → main-room agent: stored; unreachable only while the desktop is thread-scoped", async () => {
    projection(mainRow());
    const out = await resolve("please look", { threadId: T }, { toAgentId: ID, authorKind: "agent" });
    expect(out.verdict).toBe("agent");
    expect(out.recipientAgentIds).toEqual([ID]);
    expect(out.delivery).toBe(OFF);
  });

  it("main-room post → thread-bound agent: `unreachable`", async () => {
    projection(threadRow(T));
    const out = await resolve("please look", {}, { toAgentId: ID });
    expect(out.delivery).toBe(OFF);
  });

  it("thread post → agent on ANOTHER thread: `unreachable`", async () => {
    projection(threadRow(U));
    const out = await resolve("please look", { threadId: T }, { toAgentId: ID });
    expect(out.delivery).toBe(OFF);
  });

  it("on-scope addressee is still `woken`, both scopes", async () => {
    projection(threadRow(T));
    expect((await resolve("go", { threadId: T }, { toAgentId: ID })).delivery).toBe("woken");
    projection(mainRow());
    expect((await resolve("go", {}, { toAgentId: ID })).delivery).toBe("woken");
  });

  it("one reachable addressee among several keeps `woken`", async () => {
    projection(mainRow(), sessionRow({ session_key: `chan-1:${T}:z9y8x7w6`, thread_id: T, name: "z9y8x7w6" }));
    const out = await resolve("both", { threadId: T }, { toAgentIds: [ID, "z9y8x7w6"] });
    expect(out.delivery).toBe("woken");
  });

  it("a member named alongside reached somebody: not `unreachable`", async () => {
    projection(mainRow());
    const out = await resolve("hi", { threadId: T }, { toAgentId: ID, toUserIds: ["user-2"] });
    expect(out.delivery).not.toBe("unreachable");
  });
});
