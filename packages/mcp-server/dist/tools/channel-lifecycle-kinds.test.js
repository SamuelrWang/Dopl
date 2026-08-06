"use strict";
/**
 * P0-2 / P0-3 — THE AGENT'S WRITE SURFACE, after the 2026-08-04 incident.
 *
 * WHAT HAPPENED. A responder agent finished its work and posted the ANSWER as
 * `kind:"task_finished"`. On the requester's side it appeared nowhere:
 * `lib/group-thread.ts` folds a terminal marker into `draft.endEvent` and never
 * pushes it to `draft.entries`, so its body is structurally unrenderable. The
 * runtime was innocent — the desktop's delivery call emits no `kind` at all and
 * the MCP default is `message`. The AGENT chose the kind, because the surface
 * offered five values in one flat enum with no rule about whose each one is.
 *
 * TWO CHANGES ARE PINNED HERE:
 *   1. `op="post"` REFUSES the three lifecycle kinds, before any round-trip, with
 *      a message that says what to do instead. (The authoritative refusal is the
 *      server's — `service-writes.assertLifecycleKindIsServerOwned` — and lives
 *      in the app's own suite. This one is the fast, teaching half.)
 *   2. `op="milestone"` exists, so the milestone lane is a different CALL rather
 *      than a different `kind` on the same call. That is the seam: the two acts
 *      can no longer be confused by picking wrongly between adjacent enum values.
 *
 * The stub client is hand-rolled; nothing transports. What each assertion is
 * really watching for is a REGRESSION OF THE SURFACE, not of the transport: if
 * the refusal is removed, or the milestone op silently starts accepting a kind
 * again, the incident's whole runway is back.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const channel_ops_write_1 = require("./channel-ops-write");
const channel_1 = require("./channel");
const CHANNEL = {
    id: "chan-1",
    slug: "general",
    name: "General",
    visibility: "private",
};
const THREAD_ID = "79ce5325-f53e-4d00-a1c0-f48875000bc0";
/** The three kinds that state a RUNTIME fact and are not an agent's to post. */
const LIFECYCLE_KINDS = ["task_started", "task_finished", "task_failed"];
function stubClient(overrides = {}) {
    return {
        listChannels: vitest_1.vi.fn(async () => [CHANNEL]),
        listChannelThreads: vitest_1.vi.fn(async () => []),
        postChannelMessage: vitest_1.vi.fn(async (_c, input) => ({
            id: "m1",
            seq: 7,
            kind: input.kind ?? "message",
            authorUserId: "u-me",
            metadata: input.metadata ?? {},
        })),
        ...overrides,
    };
}
/** Drive the real registrar so the ROUTING is under test, not just the handler. */
function callTool(client) {
    let handler;
    const register = (_n, _d, _s, h) => {
        handler = h;
    };
    (0, channel_1.registerChannelTool)(register, client);
    return handler;
}
// ── 1. the refusal ─────────────────────────────────────────────────────────────
(0, vitest_1.describe)('op="post" refuses the lifecycle kinds (P0-2)', () => {
    vitest_1.it.each(LIFECYCLE_KINDS)("refuses %s WITHOUT any round-trip", async (kind) => {
        const client = stubClient();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "Here is the finished analysis…", { kind });
        (0, vitest_1.expect)(res.isError).toBe(true);
        // "Nothing was sent" has to be TRUE, not merely claimed: the failure mode is
        // an agent that believes it delivered. Refused ahead of the channel lookup,
        // so not even the resolve happens.
        (0, vitest_1.expect)(client.postChannelMessage).not.toHaveBeenCalled();
        (0, vitest_1.expect)(client.listChannels).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("leads with the CONSEQUENCE, because that is what changes behaviour", async () => {
        // An agent that reached for `task_finished` believed it was delivering. The
        // sentence that moves it is "the body is not shown", not "that kind is
        // reserved" — so both the effect and the remedy are pinned.
        const text = (await (0, channel_ops_write_1.opPost)(stubClient(), "general", "done", { kind: "task_finished" })).content[0].text;
        (0, vitest_1.expect)(text).toContain("Nothing was sent");
        (0, vitest_1.expect)(text).toContain("its body is not shown at all");
        (0, vitest_1.expect)(text).toContain("delivered nowhere");
        // The remedy, in the two forms it can take.
        (0, vitest_1.expect)(text).toContain("drop `kind` entirely and post the same text");
        (0, vitest_1.expect)(text).toContain('op="milestone"');
        // And the rule that generalizes it.
        (0, vitest_1.expect)(text).toContain("FINAL ANSWER included");
    });
    (0, vitest_1.it)("names the kind the caller actually passed", async () => {
        for (const kind of LIFECYCLE_KINDS) {
            const text = (await (0, channel_ops_write_1.opPost)(stubClient(), "general", "x", { kind })).content[0].text;
            (0, vitest_1.expect)(text).toContain(`kind="${kind}"`);
        }
    });
});
(0, vitest_1.describe)("what the refusal must NOT catch", () => {
    (0, vitest_1.it)("task_progress still posts: it is the milestone lane", async () => {
        const client = stubClient();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "schema half landed", {
            kind: "task_progress",
            thread: THREAD_ID,
        });
        (0, vitest_1.expect)(res.isError).toBeFalsy();
        (0, vitest_1.expect)(client.postChannelMessage).toHaveBeenCalled();
    });
    (0, vitest_1.it)("a plain message posts, which is the entire point of the rule", async () => {
        const client = stubClient();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "Here is the answer.", {});
        (0, vitest_1.expect)(res.isError).toBeFalsy();
        const [, input] = vitest_1.vi.mocked(client.postChannelMessage).mock.calls[0];
        // No kind on the wire at all — the default is what every substantive post is.
        (0, vitest_1.expect)(input.kind).toBeUndefined();
    });
});
// ── 2. the milestone op ────────────────────────────────────────────────────────
(0, vitest_1.describe)('op="milestone" — a different CALL, not a different kind (P0-3)', () => {
    (0, vitest_1.it)("posts a task_progress threaded under the given thread", async () => {
        const client = stubClient();
        const res = await callTool(client)({
            op: "milestone",
            channel: "general",
            thread: THREAD_ID,
            body: "schema half landed",
        });
        (0, vitest_1.expect)(res.isError).toBeFalsy();
        const [channelId, input] = vitest_1.vi.mocked(client.postChannelMessage).mock.calls[0];
        const sent = input;
        (0, vitest_1.expect)(channelId).toBe("chan-1");
        (0, vitest_1.expect)(sent.kind).toBe("task_progress");
        (0, vitest_1.expect)(sent.body).toBe("schema half landed");
        (0, vitest_1.expect)(sent.metadata).toMatchObject({ taskId: THREAD_ID });
    });
    (0, vitest_1.it)("REQUIRES a thread, where post leaves it optional", async () => {
        // An untagged milestone groups into nothing the requester is watching, which
        // is the one shape of this call that is always a mistake. `post` keeps
        // `thread` optional because an untagged post is a legitimate main-room line.
        const client = stubClient();
        const res = await callTool(client)({
            op: "milestone",
            channel: "general",
            body: "schema half landed",
        });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("thread");
        (0, vitest_1.expect)(client.postChannelMessage).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("addresses nobody: a milestone marks the thread, it does not reach for anyone", async () => {
        // `to` is a real, live param of `post` and is deliberately NOT routed through
        // here. A milestone that could address somebody would be a reply wearing a
        // marker's clothes, which is the confusion this op exists to remove.
        //
        // IT USED TO ALSO ASSERT `toAgent` / `toAgents` WERE UNSET, and those two
        // assertions were vacuous from the moment named agents were deleted (F-146):
        // `ChannelMessageInput` has no such fields, so `undefined` was the only
        // answer possible and the check could never fail. Asserting the absence of a
        // field the TYPE lacks is not coverage, it is a comment that runs.
        const client = stubClient();
        await callTool(client)({
            op: "milestone",
            channel: "general",
            thread: THREAD_ID,
            body: "step two",
            to: "peer@example.com",
        });
        const [, input] = vitest_1.vi.mocked(client.postChannelMessage).mock.calls[0];
        const sent = input;
        (0, vitest_1.expect)(sent.toUserId).toBeUndefined();
        // ...and it DID send the thread and the body, so the absence above is a
        // routing decision rather than a call that never happened. (`thread` folds
        // into the STORAGE key `metadata.taskId` at the client boundary.)
        (0, vitest_1.expect)(sent.metadata.taskId).toBe(THREAD_ID);
        (0, vitest_1.expect)(sent.body).toBe("step two");
    });
});
// ── 3. the surface still teaches the rule ──────────────────────────────────────
(0, vitest_1.describe)("the published surface says whose each kind is", () => {
    (0, vitest_1.it)("the `kind` describe stops reading as an interchangeable list", () => {
        let schema;
        const register = (_n, _d, s) => {
            schema = s;
        };
        (0, channel_1.registerChannelTool)(register, stubClient());
        // zod carries `.describe()` on the def; read it the way an MCP client would.
        const described = schema.kind.description ?? "";
        (0, vitest_1.expect)(described).toContain("LEAVE THIS UNSET");
        (0, vitest_1.expect)(described).toContain("FINAL ANSWER");
        (0, vitest_1.expect)(described).toContain("LIFECYCLE MARKERS");
        (0, vitest_1.expect)(described).toContain('op="milestone"');
    });
});
