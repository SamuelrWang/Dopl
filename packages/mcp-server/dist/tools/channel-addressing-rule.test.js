"use strict";
/**
 * THE ADDRESSING RULE, pinned against the code that actually implements it.
 *
 * A sibling of `channel-addressing.test.ts` (which is at the §2 cap and covers
 * the render surfaces) because these assertions have one subject the other file
 * does not own: whether the SENTENCES this tool emits about who a message
 * reaches are true.
 *
 * The wave these replace asserted three things that are not true, and each one
 * has a concrete failure attached:
 *
 *   F1 — "an unaddressed post triggers no agent, including in a two-member
 *        channel". `classify` keys its implicit trigger on `memberCount === 2`
 *        (dopl-desktop-app/main/targeting.js:152) and never reads `is_direct`,
 *        so a person's unaddressed message in a two-member channel IS a request
 *        for the only other member. An agent told otherwise re-posts with `to=`
 *        and the peer gets the same request twice, with two consent prompts.
 *
 *   H3 — "nobody was woken by it", said about a post that THREADED. Three
 *        routes run before `classify` (listener-messages.js:36-38) and none of
 *        them reads `to_user_id`: a first-class thread tag is fed straight into
 *        the counterparty's live session. The note rendered its claim directly
 *        above "THREADED into X — the other side reads this as a continuation".
 *
 *   H2 — "NONE of the messages above is addressed to you … do not answer them".
 *        The canonical reply in this product is UNADDRESSED
 *        (channel-post.js#postResult, prompt-framing.js#deliveryCall), so in
 *        exactly the N-party case the notice exists for it told a requester its
 *        own answer was somebody else's traffic.
 *
 * Each test below fails if the corresponding sentence comes back.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const vitest_1 = require("vitest");
const channel_addressing_1 = require("./channel-addressing");
const channel_schema_1 = require("./channel-schema");
const channel_ops_await_1 = require("./channel-ops-await");
const channel_ops_read_1 = require("./channel-ops-read");
const channel_ops_write_1 = require("./channel-ops-write");
const ME = "u-me";
const PEER = "u-peer";
/** A first-class thread id — the only shape the desktop routes on. */
const UUID = "3f1c2b90-7a44-4c2e-9b11-0d8e6a5c4321";
/** The deterministic legacy shape (`task-<channel>-<seq>`) — routes nowhere. */
const LEGACY = "task-chan-1-7";
const CHANNEL = {
    id: "chan-1",
    slug: "general",
    name: "General",
    visibility: "private",
};
function member(userId) {
    return {
        channelId: "chan-1",
        userId,
        role: "member",
        lastReadAt: null,
        addedBy: null,
        joinedAt: "2026-07-01T00:00:00Z",
        displayName: null,
        email: null,
    };
}
function postClient(channel, metadata = {}) {
    return {
        listChannels: vitest_1.vi.fn(async () => [{ ...CHANNEL, ...channel }]),
        postChannelMessage: vitest_1.vi.fn(async () => ({
            id: "m1",
            seq: 12,
            kind: "message",
            metadata,
            authorUserId: ME,
        })),
        listChannelThreads: vitest_1.vi.fn(async () => []),
    };
}
function rosterClient(userIds) {
    return {
        listChannels: vitest_1.vi.fn(async () => [CHANNEL]),
        listChannelMembers: vitest_1.vi.fn(async () => userIds.map(member)),
    };
}
// ── the two lanes state ONE number ───────────────────────────────────
(0, vitest_1.describe)("the group-channel threshold is not restated per lane", () => {
    (0, vitest_1.it)("matches the web app's GROUP_CHANNEL_MIN_MEMBERS", () => {
        // The web composer hint and the invite-dialog note both key on this
        // constant; this package cannot import across the package boundary, so the
        // copy is pinned to the original instead of trusted to stay in step. That
        // drift is exactly what produced F1: three strings, one magic rule, no link.
        const web = (0, node_fs_1.readFileSync)("../../src/features/channels/constants.ts", "utf8");
        const declared = /GROUP_CHANNEL_MIN_MEMBERS = (\d+)/.exec(web);
        (0, vitest_1.expect)(declared, "the web constant moved or was renamed").not.toBeNull();
        (0, vitest_1.expect)(Number(declared[1])).toBe(channel_addressing_1.GROUP_CHANNEL_MIN_MEMBERS);
    });
});
// ── the merged agent cap, and why nothing pins it any more ───────────
//
// `MAX_ADDRESSED_AGENTS` was a second cross-lane constant, pinned here on the
// same doctrine as the threshold above: the tool PUBLISHED it as
// `to_agents.max()`, so a copy one higher than the server's turned the declared
// surface into a promise the route refused. Named-agent addressing is gone
// (channels rollback §1) — no `to_agent`, no `to_agents`, no cap, and no
// `CHANNEL_TOO_MANY_AGENTS` code to classify.
(0, vitest_1.describe)("the removed named-agent surface is ABSENT from the published shape", () => {
    (0, vitest_1.it)("declares no to_agent / to_agents / as_agent / participants / agent / status", () => {
        // Not "declared and ignored": a param an MCP client can still see is a
        // param a model will still try, and a silently-dropped address is the
        // invisible-delivery failure the addressing contract exists to prevent.
        for (const key of ["to_agent", "to_agents", "as_agent", "participants", "agent", "status"]) {
            (0, vitest_1.expect)(channel_schema_1.CHANNEL_INPUT_SHAPE, key).not.toHaveProperty(key);
        }
    });
    (0, vitest_1.it)("REFUSES every removed op at the enum, before any handler runs", () => {
        // The seven lifecycle / membership ops. They are DROPPED rather than kept
        // for a teaching refusal — unlike `close_thread`, whose capability MOVED
        // (to `propose_close`) and whose refusal names where. These capabilities
        // are gone, so "invalid enum value" is the honest answer.
        for (const op of [
            "agents",
            "summon_agent",
            "rename_agent",
            "set_agent_status",
            "disengage_agent",
            "join_thread",
            "leave_thread",
        ]) {
            (0, vitest_1.expect)(channel_schema_1.CHANNEL_INPUT_SHAPE.op.safeParse(op).success, `op="${op}" is still accepted`).toBe(false);
        }
    });
    (0, vitest_1.it)("still accepts every op that SURVIVED, so the rollback took nothing extra", () => {
        for (const op of [
            "list",
            "open",
            "invite",
            "post",
            "milestone",
            "read",
            "await",
            "members",
            "list_threads",
            "get_thread",
            "create_thread",
            "propose_close",
            // Kept in the enum ON PURPOSE: an older agent's call gets a teaching
            // refusal naming `propose_close`, not an opaque enum error.
            "close_thread",
            "set_thread_mode",
        ]) {
            (0, vitest_1.expect)(channel_schema_1.CHANNEL_INPUT_SHAPE.op.safeParse(op).success, `op="${op}" was lost`).toBe(true);
        }
    });
});
// ── which thread tags actually route ─────────────────────────────────
(0, vitest_1.describe)("routesToASession — first-class only", () => {
    (0, vitest_1.it)("is true for a uuid thread id and false for everything else", () => {
        // Mirrors `firstClassTaskId` (targeting.js): the pre-classify routes call
        // it, and it returns '' for a legacy id, so only a uuid reaches a session.
        (0, vitest_1.expect)((0, channel_addressing_1.routesToASession)(UUID)).toBe(true);
        (0, vitest_1.expect)((0, channel_addressing_1.routesToASession)(UUID.toUpperCase())).toBe(true);
        (0, vitest_1.expect)((0, channel_addressing_1.routesToASession)(LEGACY)).toBe(false);
        (0, vitest_1.expect)((0, channel_addressing_1.routesToASession)(undefined)).toBe(false);
        (0, vitest_1.expect)((0, channel_addressing_1.routesToASession)("")).toBe(false);
        (0, vitest_1.expect)((0, channel_addressing_1.routesToASession)(`${UUID} `)).toBe(false);
    });
});
// ── the post note ────────────────────────────────────────────────────
(0, vitest_1.describe)("unaddressedPostNote", () => {
    const base = { ref: "chan-1", isDirect: false, landedThread: undefined };
    (0, vitest_1.it)("says nothing when the caller addressed someone, or the channel is direct", () => {
        (0, vitest_1.expect)((0, channel_addressing_1.unaddressedPostNote)({ ...base, addressed: true })).toBeNull();
        (0, vitest_1.expect)((0, channel_addressing_1.unaddressedPostNote)({ ...base, isDirect: true, addressed: false })).toBeNull();
    });
    (0, vitest_1.it)("names the AUTHOR KIND as the reason, never the member count", () => {
        const note = (0, channel_addressing_1.unaddressedPostNote)({ ...base, addressed: false });
        (0, vitest_1.expect)(note).toContain("NOT ADDRESSED");
        (0, vitest_1.expect)(note).toContain("from an AGENT is never taken as an implicit request");
        // F1: the claim that produced duplicate requests. A two-member channel is
        // NOT a channel where an unaddressed message reaches nobody.
        (0, vitest_1.expect)(note).not.toContain("nobody was woken");
        (0, vitest_1.expect)(note).not.toMatch(/including a two-member/i);
    });
    (0, vitest_1.it)("does NOT claim silence for a post that landed on a first-class thread", () => {
        const note = (0, channel_addressing_1.unaddressedPostNote)({
            ...base,
            addressed: false,
            landedThread: UUID,
        });
        (0, vitest_1.expect)(note).toContain("NOT ADDRESSED, BUT THREADED");
        (0, vitest_1.expect)(note).toContain("may be in front of their agent right now");
        // H3's second half: the old remedy manufactured the duplicate request.
        (0, vitest_1.expect)(note).toContain("Do NOT re-post it with `to=`");
        (0, vitest_1.expect)(note).not.toMatch(/re-post it with to="/);
    });
    (0, vitest_1.it)("keeps the plain note for a LEGACY tag, which routes to no session", () => {
        const note = (0, channel_addressing_1.unaddressedPostNote)({
            ...base,
            addressed: false,
            landedThread: LEGACY,
        });
        (0, vitest_1.expect)(note).not.toContain("BUT THREADED");
        (0, vitest_1.expect)(note).toContain("from an AGENT is never taken as an implicit request");
    });
});
(0, vitest_1.describe)("post — the note and the linkage line in one result", () => {
    (0, vitest_1.it)("a threaded post never says nobody was woken next to 'reads this as a continuation'", async () => {
        const client = postClient({ isDirect: false }, { taskId: UUID });
        const text = (await (0, channel_ops_write_1.opPost)(client, "general", "here is the diff")).content[0]
            .text;
        (0, vitest_1.expect)(text).toContain("NOT ADDRESSED, BUT THREADED");
        (0, vitest_1.expect)(text).toContain("the other side reads this as a continuation");
        (0, vitest_1.expect)(text).not.toContain("nobody was woken");
        (0, vitest_1.expect)(text).not.toContain("NO member's agent was triggered");
    });
    (0, vitest_1.it)("an unthreaded post still tells the sender it has to address a member", async () => {
        const client = postClient({ isDirect: false });
        const text = (await (0, channel_ops_write_1.opPost)(client, "general", "anyone free?")).content[0]
            .text;
        (0, vitest_1.expect)(text).toContain("NOT ADDRESSED");
        (0, vitest_1.expect)(text).not.toContain("BUT THREADED");
        (0, vitest_1.expect)(text).toContain('re-post it with to="<one member>"');
    });
    (0, vitest_1.it)("stays silent in a DIRECT channel, where the server addresses the post", async () => {
        const client = postClient({ isDirect: true }, { taskId: UUID });
        const text = (await (0, channel_ops_write_1.opPost)(client, "general", "ping")).content[0].text;
        (0, vitest_1.expect)(text).not.toContain("NOT ADDRESSED");
    });
});
// ── the roster rule ──────────────────────────────────────────────────
(0, vitest_1.describe)("rosterAddressingRule — stated from the count it just read", () => {
    (0, vitest_1.it)("at two members, an unaddressed message CAN be an implicit request", () => {
        const rule = (0, channel_addressing_1.rosterAddressingRule)("general", 2);
        (0, vitest_1.expect)(rule).toContain("Two members is the ONE size");
        (0, vitest_1.expect)(rule).toContain("from a PERSON as meant for the only other member");
        // …and the caller's own posts still are not, which is why `to` still matters.
        (0, vitest_1.expect)(rule).toContain("A post from an AGENT never counts");
    });
    (0, vitest_1.it)("at three or more it really does reach nobody, and says so with the number", () => {
        (0, vitest_1.expect)((0, channel_addressing_1.rosterAddressingRule)("general", channel_addressing_1.GROUP_CHANNEL_MIN_MEMBERS)).toContain("With 3 members, an UNADDRESSED, UNTHREADED post reaches no one's agent");
        (0, vitest_1.expect)((0, channel_addressing_1.rosterAddressingRule)("general", 9)).toContain("With 9 members");
        (0, vitest_1.expect)((0, channel_addressing_1.rosterAddressingRule)("general", 9)).not.toContain("implicit request");
    });
    (0, vitest_1.it)("never claims the auto-addressing half it cannot see", () => {
        for (const n of [1, 2, 3, 9]) {
            const rule = (0, channel_addressing_1.rosterAddressingRule)("general", n);
            (0, vitest_1.expect)(rule).toContain("it cannot tell you whether this is one");
            (0, vitest_1.expect)(rule).not.toMatch(/including a two-member/i);
            // H3 at every size: a thread tag routes past the addressing entirely, so no
            // branch may say an unaddressed post reaches nobody without that caveat.
            (0, vitest_1.expect)(rule).toContain("routes the post into the session already working it");
        }
    });
    (0, vitest_1.it)("a roster of one has nobody to address", () => {
        (0, vitest_1.expect)((0, channel_addressing_1.rosterAddressingRule)("general", 1)).toContain("nobody else on this roster to address");
    });
});
(0, vitest_1.describe)("members — the rule reaches the result", () => {
    (0, vitest_1.it)("a two-member roster is told the two-member rule", async () => {
        const text = (await (0, channel_ops_read_1.opMembers)(rosterClient([ME, PEER]), "general", ME))
            .content[0].text;
        (0, vitest_1.expect)(text).toContain("Two members is the ONE size");
        (0, vitest_1.expect)(text).not.toContain("it triggers nobody");
    });
    (0, vitest_1.it)("a three-member roster is told the group rule", async () => {
        const text = (await (0, channel_ops_read_1.opMembers)(rosterClient([ME, PEER, "u-c"]), "general", ME))
            .content[0].text;
        (0, vitest_1.expect)(text).toContain("With 3 members, an UNADDRESSED, UNTHREADED post reaches no one's agent");
        (0, vitest_1.expect)(text).not.toContain("Two members is the ONE size");
    });
});
// ── the await notice ─────────────────────────────────────────────────
(0, vitest_1.describe)("AWAIT_UNNAMED_NOTICE — a wake that names nobody", () => {
    (0, vitest_1.it)("does not tell a waiting agent that its own answer belongs to someone else", () => {
        // H2. Both halves of the fact are in the desktop: `postResult` posts the
        // responder's reply with no `toUserId`, and `deliveryCall` teaches the
        // delivery call with no `to`. So "nothing here is addressed to you" cannot
        // be narrowed to "none of this is yours".
        (0, vitest_1.expect)(channel_addressing_1.AWAIT_UNNAMED_NOTICE).toContain("a reply here is normally posted UNADDRESSED");
        (0, vitest_1.expect)(channel_addressing_1.AWAIT_UNNAMED_NOTICE).toContain("that is your reply");
        (0, vitest_1.expect)(channel_addressing_1.AWAIT_UNNAMED_NOTICE).not.toContain("Do not answer them");
        (0, vitest_1.expect)(channel_addressing_1.AWAIT_UNNAMED_NOTICE).not.toContain("they are context.");
    });
    (0, vitest_1.it)("accounts for threading, which the addressing field cannot express", () => {
        (0, vitest_1.expect)(channel_addressing_1.AWAIT_UNNAMED_NOTICE).toContain("THREADED into an exchange you are a party to is for you");
    });
    (0, vitest_1.it)("still refuses another member's request", () => {
        (0, vitest_1.expect)(channel_addressing_1.AWAIT_UNNAMED_NOTICE).toContain("aimed at another member");
        (0, vitest_1.expect)(channel_addressing_1.AWAIT_UNNAMED_NOTICE).toContain("adopt an unaddressed message as a task you were assigned");
    });
});
// ── ...and WHEN it fires, which is a separate claim ───────────────────
//
// The notice's premise is "somebody ELSE wrote things and none of them names
// you". The predicate ran over the whole page including the caller's OWN posts,
// so it fired live on a page holding exactly one message — the caller's own
// request, addressed to the peer — and told the agent "NONE of the messages
// above NAMES you" about a message the agent had just written. `opAwait` also
// passes `excludeAuthor` now, so own posts should not reach the render at all;
// this is the second line of defence, because the notice must be false-free on
// whatever it is handed.
(0, vitest_1.describe)("AWAIT_UNNAMED_NOTICE — over messages SOMEONE ELSE wrote", () => {
    function awaitClient(messages) {
        vitest_1.vi.spyOn(Date, "now").mockReturnValue(1_000_000);
        return {
            listChannels: vitest_1.vi.fn(async () => [CHANNEL]),
            awaitChannelMessages: vitest_1.vi.fn(async () => ({ messages, timedOut: false })),
        };
    }
    function message(seq, authorUserId, toUserId) {
        return {
            id: `m-${seq}`,
            seq,
            channelId: "chan-1",
            authorUserId,
            authorKind: "agent",
            kind: "message",
            body: "the body",
            metadata: toUserId ? { to_user_id: toUserId } : {},
            clientMsgId: null,
            createdAt: "2026-07-31T00:00:00Z",
        };
    }
    async function noticeFor(messages, selfUserId = ME) {
        const res = await (0, channel_ops_await_1.opAwait)(awaitClient(messages), "general", 7, undefined, selfUserId);
        return res.content[0].text;
    }
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.it)("says NOTHING when every message on the page is the caller's own", async () => {
        // The observed live case: one message, mine, addressed to the peer.
        const text = await noticeFor([message(8, ME, PEER)]);
        (0, vitest_1.expect)(text).not.toContain("NONE of the messages above NAMES you");
    });
    (0, vitest_1.it)("still fires when a peer wrote something that names nobody", async () => {
        (0, vitest_1.expect)(await noticeFor([message(8, PEER)])).toContain("NONE of the messages above NAMES you");
    });
    (0, vitest_1.it)("stays silent when a peer's message DOES name the caller", async () => {
        (0, vitest_1.expect)(await noticeFor([message(8, PEER, ME)])).not.toContain("NONE of the messages above NAMES you");
    });
    (0, vitest_1.it)("judges the peer's messages alone — the caller's own can't suppress it", async () => {
        // Mixed page: my own post naming the peer, plus their unaddressed reply.
        // The notice is about theirs, and the presence of mine changes nothing.
        (0, vitest_1.expect)(await noticeFor([message(8, ME, PEER), message(9, PEER)])).toContain("NONE of the messages above NAMES you");
    });
    (0, vitest_1.it)("says nothing at all when the caller's own id is unknown", async () => {
        (0, vitest_1.expect)(await noticeFor([message(8, PEER)], null)).not.toContain("NONE of the messages above NAMES you");
    });
});
