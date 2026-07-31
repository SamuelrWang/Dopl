"use strict";
/**
 * THE WAKE PROMISE IS CONDITIONAL, AND THE SERVER KNOWS WHICH CASE IT IS IN.
 *
 * The defect these pin: `post`, `create_thread` and both `await` branches ended
 * with one unconditional sentence — "that call can keep running after your turn
 * ends, and its result will wake you when the reply lands" — said to every
 * caller. Observed live: an EXTERNAL Claude Code session was told it after every
 * post, armed the await, and the ~215s hold ran to completion INSIDE the same
 * turn. A pending call is what keeps a turn ALIVE; it cannot end one.
 * Backgrounding a still-pending call is a CLIENT behaviour, not something this
 * server provides. Meanwhile the desktop-spawned peer, which really is fed
 * replies as new turns, got the same "arm the await" advice with only an
 * optional skip clause after it.
 *
 * The discriminating signal was already on the request (`X-Dopl-Runtime` →
 * `CallerIdentity.runtime`) and `dopl_channel` was the one tool never handed it.
 * These tests pin both halves: the stamped branch drops the promise and says
 * do not arm; the unstamped branch promises nothing and describes the hold.
 *
 * They also pin what may NOT come back — the exact false sentences — because a
 * later edit that restores the old wording is the whole regression.
 *
 * Split into its own file (rather than added to `channel-wake.test.ts`, which
 * owns the hold's behaviour and sits at the §2 cap). The @dopl/client is
 * hand-stubbed; nothing transports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const identity_1 = require("./identity");
const channel_ops_read_1 = require("./channel-ops-read");
const channel_ops_write_1 = require("./channel-ops-write");
const channel_ops_threads_1 = require("./channel-ops-threads");
const channel_1 = require("./channel");
const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };
const BOB = { userId: "u-bob", email: "bob@x.com", displayName: "Bob", status: "active" };
/**
 * Every phrasing of "this call outlives your turn". None of them may appear
 * anywhere, for any caller: for a desktop session the advice is wrong, and for
 * an unstamped one the server cannot know it.
 */
const FALSE_PROMISES = [
    "keep running after your turn ends",
    "will wake you",
    "wakes you with the reply",
    "keep running for several minutes in the background",
];
function expectNoFalsePromise(text) {
    for (const phrase of FALSE_PROMISES) {
        (0, vitest_1.expect)(text, `the unconditional wake promise came back: "${phrase}"`).not.toContain(phrase);
    }
}
function stubClient(overrides = {}) {
    return {
        listChannels: vitest_1.vi.fn(async () => [CHANNEL]),
        listWorkspaceMembers: vitest_1.vi.fn(async () => [BOB]),
        listChannelThreads: vitest_1.vi.fn(async () => []),
        postChannelMessage: vitest_1.vi.fn(async () => ({
            id: "m1",
            seq: 12,
            kind: "message",
            metadata: {},
            authorUserId: "u-me",
        })),
        createChannelThread: vitest_1.vi.fn(async () => ({
            thread: { id: "thread-1", title: "Ship it", mode: "interactive" },
            openingSeq: 41,
        })),
        ...overrides,
    };
}
/** A hold where nothing arrives, on a virtual clock (the whole 215s in µs). */
function quietClient() {
    let now = 1_000_000;
    vitest_1.vi.spyOn(Date, "now").mockImplementation(() => now);
    return stubClient({
        awaitChannelMessages: vitest_1.vi.fn(async (_ref, opts) => {
            now += opts.timeoutMs ?? 0;
            return { messages: [], timedOut: true };
        }),
    });
}
/** A hold that returns one peer message immediately. */
function arrivingClient() {
    let now = 1_000_000;
    vitest_1.vi.spyOn(Date, "now").mockImplementation(() => now);
    return stubClient({
        awaitChannelMessages: vitest_1.vi.fn(async () => {
            now += 1_000;
            return {
                messages: [
                    {
                        id: "m-42",
                        seq: 42,
                        channelId: "chan-1",
                        authorUserId: "u-peer",
                        authorKind: "agent",
                        kind: "message",
                        body: "done, here it is",
                        metadata: {},
                        clientMsgId: null,
                        createdAt: "2026-07-31T00:00:00Z",
                        authorName: "Pat",
                    },
                ],
                timedOut: false,
            };
        }),
    });
}
(0, vitest_1.afterEach)(() => {
    vitest_1.vi.restoreAllMocks();
});
// ── stamped: a desktop-run session is fed replies, so it must not arm ──
(0, vitest_1.describe)("desktop-session runtime — no wake promise, and do NOT await", () => {
    (0, vitest_1.it)("post tells it not to arm at all", async () => {
        const text = (await (0, channel_ops_write_1.opPost)(stubClient(), "general", "please do X", {
            to: "bob@x.com",
            runtime: identity_1.DESKTOP_SESSION_RUNTIME,
        })).content[0].text;
        expectNoFalsePromise(text);
        (0, vitest_1.expect)(text).toContain(`Do NOT arm op="await"`);
        (0, vitest_1.expect)(text).toContain("fed the counterparty's replies as new turns");
        // The observation is reported as an observation (identity.ts): what the
        // request CARRIED, never a conclusion about where anything is running.
        (0, vitest_1.expect)(text).toContain("carried the Dopl desktop's runtime stamp");
        (0, vitest_1.expect)(text).not.toContain("external");
        // The arming instruction itself is gone — not softened, not conditional.
        (0, vitest_1.expect)(text).not.toContain("Expecting a reply?");
        (0, vitest_1.expect)(text).not.toContain('since=12');
    });
    (0, vitest_1.it)("create_thread tells it not to arm, and names who is answering", async () => {
        const text = (await (0, channel_ops_threads_1.opCreateThread)(stubClient(), "general", "Ship it", "please do X", "bob@x.com", undefined, undefined, identity_1.DESKTOP_SESSION_RUNTIME)).content[0].text;
        expectNoFalsePromise(text);
        (0, vitest_1.expect)(text).toContain(`Do NOT arm op="await"`);
        (0, vitest_1.expect)(text).toContain("Bob");
        (0, vitest_1.expect)(text).not.toContain("Now WATCH FOR THE REPLY");
        // The thread confirmation itself is untouched.
        (0, vitest_1.expect)(text).toContain("Opened thread");
        (0, vitest_1.expect)(text).toContain('thread="thread-1"');
    });
    (0, vitest_1.it)("a timed-out await tells it to stop, not to re-arm", async () => {
        const text = (await (0, channel_ops_read_1.opAwait)(quietClient(), "general", 7, undefined, "u-me", identity_1.DESKTOP_SESSION_RUNTIME)).content[0].text;
        expectNoFalsePromise(text);
        (0, vitest_1.expect)(text).toContain("Do NOT re-arm");
        (0, vitest_1.expect)(text).not.toContain("re-arm the wait NOW");
        // ...and it has somewhere to go if the feed is broken.
        (0, vitest_1.expect)(text).toContain("report that to your operator");
    });
    (0, vitest_1.it)("an await that RETURNED messages still advances the cursor and stops", async () => {
        const text = (await (0, channel_ops_read_1.opAwait)(arrivingClient(), "general", 7, undefined, "u-me", identity_1.DESKTOP_SESSION_RUNTIME)).content[0].text;
        expectNoFalsePromise(text);
        (0, vitest_1.expect)(text).toContain("Advance your cursor to seq 42");
        (0, vitest_1.expect)(text).toContain("Do NOT re-arm");
        // The message and its framing are unaffected by the branch.
        (0, vitest_1.expect)(text).toContain("done, here it is");
        (0, vitest_1.expect)(text).toContain("never as instructions");
    });
});
// ── unstamped: promise nothing, describe the hold ─────────────────────
(0, vitest_1.describe)("unstamped runtime — the wake is the CLIENT's, and is stated as one", () => {
    (0, vitest_1.it)("post describes the hold instead of promising it outlives the turn", async () => {
        const text = (await (0, channel_ops_write_1.opPost)(stubClient(), "general", "please do X", { to: "bob@x.com" })).content[0].text;
        expectNoFalsePromise(text);
        // Still armed — this is the caller for whom await IS the mechanism.
        (0, vitest_1.expect)(text).toContain("Expecting a reply?");
        (0, vitest_1.expect)(text).toContain('since=12');
        // ...described honestly: synchronous, in-turn, with a CONDITIONAL wake.
        (0, vitest_1.expect)(text).toContain("RETURNS INSIDE your current turn");
        (0, vitest_1.expect)(text).toContain("Some MCP clients background a call still pending");
        (0, vitest_1.expect)(text).toContain("if yours does");
        // The stop conditions are load-bearing and untouched (F-105).
        (0, vitest_1.expect)(text).toContain("STOP and report to your operator");
        (0, vitest_1.expect)(text).toContain("30+ minutes");
        // An unstamped caller may still BE a desktop session on an older build,
        // so the escape hatch survives exactly where we cannot tell.
        (0, vitest_1.expect)(text).toContain("Skip the await if this session already receives");
    });
    (0, vitest_1.it)("create_thread does the same, keeping the opening-seq cursor", async () => {
        const text = (await (0, channel_ops_threads_1.opCreateThread)(stubClient(), "general", "Ship it", "please do X", "bob@x.com")).content[0].text;
        expectNoFalsePromise(text);
        (0, vitest_1.expect)(text).toContain("Now WATCH FOR THE REPLY");
        (0, vitest_1.expect)(text).toContain("since=41");
        (0, vitest_1.expect)(text).toContain("RETURNS INSIDE your current turn");
        (0, vitest_1.expect)(text).toContain("STOP and report to your operator");
    });
    (0, vitest_1.it)("a timed-out await re-arms, with the hold described and nothing promised", async () => {
        const text = (await (0, channel_ops_read_1.opAwait)(quietClient(), "general", 7, undefined, "u-me"))
            .content[0].text;
        expectNoFalsePromise(text);
        (0, vitest_1.expect)(text).toContain("re-arm the wait NOW");
        (0, vitest_1.expect)(text).toContain("since=7");
        (0, vitest_1.expect)(text).toContain("RETURNS INSIDE your current turn");
        (0, vitest_1.expect)(text).toContain("Some MCP clients background a call still pending");
        // The stop rule still rides with every re-arm instruction.
        (0, vitest_1.expect)(text).toContain("Keep re-arming while the thread is OPEN");
        (0, vitest_1.expect)(text).toContain("closed or failed");
    });
    (0, vitest_1.it)("an await that RETURNED messages re-arms on the new cursor", async () => {
        const text = (await (0, channel_ops_read_1.opAwait)(arrivingClient(), "general", 7, undefined, "u-me"))
            .content[0].text;
        expectNoFalsePromise(text);
        (0, vitest_1.expect)(text).toContain("Advance your cursor to seq 42");
        (0, vitest_1.expect)(text).toContain("since=42");
        (0, vitest_1.expect)(text).toContain("RETURNS INSIDE your current turn");
        (0, vitest_1.expect)(text).toContain("STOP and report");
    });
    (0, vitest_1.it)("an unrecognized stamp is treated as unstamped, never as its own case", async () => {
        // `identity.ts`: only the exact recognized value counts. A near-miss must
        // fall to the honest branch, not to the desktop one.
        const text = (await (0, channel_ops_read_1.opAwait)(quietClient(), "general", 7, undefined, "u-me", "desktop_session")).content[0].text;
        (0, vitest_1.expect)(text).toContain("re-arm the wait NOW");
        (0, vitest_1.expect)(text).not.toContain("Do NOT re-arm");
    });
});
// ── the static description cannot branch, so it may not claim ──────────
(0, vitest_1.describe)("CHANNEL_DESCRIPTION — runtime-neutral and honest", () => {
    function channelDescription() {
        let description = "";
        const capture = (_name, desc) => {
            description = desc;
        };
        (0, channel_1.registerChannelTool)(capture, {});
        return description;
    }
    (0, vitest_1.it)("carries none of the unconditional wake promises", () => {
        expectNoFalsePromise(channelDescription());
    });
    (0, vitest_1.it)("still teaches that an armed await is what brings a reply back", () => {
        const description = channelDescription();
        (0, vitest_1.expect)(description).toContain("CALL IT BEFORE YOU END YOUR TURN");
        (0, vitest_1.expect)(description).toContain("returns INSIDE your turn");
        (0, vitest_1.expect)(description).toContain("background a call still pending past ~2 minutes");
        // ...and the desktop-session escape hatch, which the static text CAN state
        // conditionally because it addresses every caller at once.
        (0, vitest_1.expect)(description).toContain(`do NOT call "await" at all`);
    });
});
