"use strict";
/**
 * THE TWO-AGENT HANDSHAKE KEY — the half of the contract this package owns.
 *
 * THE BUG (BLOCKER-1), in one line: THE LAW told an agent to pass
 * `client_msg_id="thread-open-<channelId>-<seq>"`, the `channel` param takes a
 * SLUG or an id, and `parseHandshakeSeq` anchors on the UUID. An agent holding
 * only the slug therefore followed the instructions exactly and produced a key
 * that derived NO participant set, on a create that returned 200 — and the
 * failure surfaced on the OTHER machine, one turn later, as a `mayWriteThread`
 * 403 on the thread it had been told to use. "Told to join a room, locked out
 * of it": the exact failure `service-thread-handshake.ts` exists to prevent.
 *
 * What is pinned here:
 *
 *  - the parse this package performs AGREES WITH THE SERVER'S. Two independent
 *    parsers of one string is how the original ambiguity survived review, so
 *    the prefix and the seq rules are read out of the server file rather than
 *    trusted to stay in step (the `GROUP_CHANNEL_MIN_MEMBERS` doctrine);
 *  - a slug-form key is REWRITTEN onto the resolved uuid, not refused — and the
 *    two forms therefore CONVERGE on one key, which a refusal would not do;
 *  - the rewrite is REPORTED, because silently changing a caller's idempotency
 *    key teaches it nothing and it has to mint the same string next turn;
 *  - a `thread-open-` key with no seq is REFUSED, because there is nothing to
 *    repair and passing it through restores the silent miss;
 *  - an ordinary idempotency key is untouched, byte for byte.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const channel_handshake_key_1 = require("./channel-handshake-key");
const channel_ops_threads_1 = require("./channel-ops-threads");
const CHANNEL = {
    id: "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
    slug: "general",
    name: "General",
    visibility: "private",
};
// ── the two parsers agree ────────────────────────────────────────────
(0, vitest_1.describe)("the tool's handshake parse matches the server's", () => {
    const server = (0, node_fs_1.readFileSync)("../../src/features/channels/server/service-thread-handshake.ts", "utf8");
    (0, vitest_1.it)("uses the same prefix the server anchors on", () => {
        const declared = /HANDSHAKE_PREFIX = "([^"]+)"/.exec(server);
        (0, vitest_1.expect)(declared, "the server constant moved or was renamed").not.toBeNull();
        (0, vitest_1.expect)(declared[1]).toBe(channel_handshake_key_1.HANDSHAKE_PREFIX);
    });
    (0, vitest_1.it)("mints a key the server's own parser accepts", () => {
        // The server's rule, restated as the assertion rather than as prose: the
        // key is the prefix, the CHANNEL ID, a hyphen, and a digit run. If either
        // side's shape moves, the round trip below stops holding.
        const out = (0, channel_handshake_key_1.normalizeHandshakeKey)(`${channel_handshake_key_1.HANDSHAKE_PREFIX}general-42`, CHANNEL.id);
        (0, vitest_1.expect)(out.status).toBe("ok");
        (0, vitest_1.expect)(out.status === "ok" && out.key).toBe(`${channel_handshake_key_1.HANDSHAKE_PREFIX}${CHANNEL.id}-42`);
        const rest = (out.status === "ok" ? out.key : "").slice(`${channel_handshake_key_1.HANDSHAKE_PREFIX}${CHANNEL.id}-`.length);
        (0, vitest_1.expect)(rest).toMatch(/^\d+$/);
        (0, vitest_1.expect)(Number(rest)).toBeGreaterThanOrEqual(1);
    });
});
// ── the normalizer ───────────────────────────────────────────────────
(0, vitest_1.describe)("normalizeHandshakeKey", () => {
    (0, vitest_1.it)("leaves a non-handshake key completely alone", () => {
        (0, vitest_1.expect)((0, channel_handshake_key_1.normalizeHandshakeKey)("my-own-idempotency-key", CHANNEL.id)).toEqual({
            status: "passthrough",
        });
        (0, vitest_1.expect)((0, channel_handshake_key_1.normalizeHandshakeKey)(undefined, CHANNEL.id)).toEqual({
            status: "passthrough",
        });
    });
    (0, vitest_1.it)("rewrites the SLUG form onto the resolved uuid", () => {
        const out = (0, channel_handshake_key_1.normalizeHandshakeKey)(`${channel_handshake_key_1.HANDSHAKE_PREFIX}general-42`, CHANNEL.id);
        (0, vitest_1.expect)(out).toEqual({
            status: "ok",
            key: `${channel_handshake_key_1.HANDSHAKE_PREFIX}${CHANNEL.id}-42`,
            seq: 42,
            rewritten: true,
        });
    });
    (0, vitest_1.it)("leaves an already-correct key unchanged, and says it did not rewrite it", () => {
        const key = `${channel_handshake_key_1.HANDSHAKE_PREFIX}${CHANNEL.id}-42`;
        (0, vitest_1.expect)((0, channel_handshake_key_1.normalizeHandshakeKey)(key, CHANNEL.id)).toEqual({
            status: "ok",
            key,
            seq: 42,
            rewritten: false,
        });
    });
    (0, vitest_1.it)("CONVERGES the slug form and the id form on ONE key", () => {
        // THE REASON THE TEETH ARE A REWRITE AND NOT A REFUSAL. Two agents were
        // addressed together; one holds the slug and one holds the id. Refusing the
        // slug form leaves two DIFFERENT keys whenever the loser retries with its
        // own form — and two distinct `client_msg_id`s mean the partial unique
        // index inserts TWO THREADS for one instruction, which is the other half of
        // the failure the handshake exists to prevent.
        const fromSlug = (0, channel_handshake_key_1.normalizeHandshakeKey)(`${channel_handshake_key_1.HANDSHAKE_PREFIX}general-42`, CHANNEL.id);
        const fromId = (0, channel_handshake_key_1.normalizeHandshakeKey)(`${channel_handshake_key_1.HANDSHAKE_PREFIX}${CHANNEL.id}-42`, CHANNEL.id);
        (0, vitest_1.expect)(fromSlug.status === "ok" && fromSlug.key).toBe(fromId.status === "ok" && fromId.key);
    });
    (0, vitest_1.it)("refuses a handshake key with no seq — there is nothing to repair", () => {
        (0, vitest_1.expect)((0, channel_handshake_key_1.normalizeHandshakeKey)(`${channel_handshake_key_1.HANDSHAKE_PREFIX}general`, CHANNEL.id)).toEqual({ status: "malformed" });
        (0, vitest_1.expect)((0, channel_handshake_key_1.normalizeHandshakeKey)(`${channel_handshake_key_1.HANDSHAKE_PREFIX}general-abc`, CHANNEL.id)).toEqual({ status: "malformed" });
    });
    (0, vitest_1.it)("refuses a seq the server's own parser would reject", () => {
        // `parseHandshakeSeq` fails closed on seq < 1 (the column is a 1-based
        // identity) and on a digit run past integer precision. A key we "repaired"
        // into one of those would be a silent miss wearing a canonical shape.
        (0, vitest_1.expect)((0, channel_handshake_key_1.normalizeHandshakeKey)(`${channel_handshake_key_1.HANDSHAKE_PREFIX}general-0`, CHANNEL.id)).toEqual({ status: "malformed" });
        (0, vitest_1.expect)((0, channel_handshake_key_1.normalizeHandshakeKey)(`${channel_handshake_key_1.HANDSHAKE_PREFIX}general-99999999999999999999`, CHANNEL.id)).toEqual({ status: "malformed" });
    });
});
function stubClient() {
    const createChannelThread = vitest_1.vi.fn(async () => ({
        thread: { id: "t-1", title: "Work", mode: "interactive" },
        openingSeq: 43,
    }));
    const client = {
        listChannels: vitest_1.vi.fn(async () => [CHANNEL]),
        listWorkspaceMembers: vitest_1.vi.fn(async () => [
            { userId: "u-bob", email: "bob@x.com", displayName: "Bob", status: "active" },
        ]),
        createChannelThread,
    };
    return { client, createChannelThread };
}
(0, vitest_1.describe)("opCreateThread — the key that actually goes on the wire", () => {
    (0, vitest_1.it)("sends the UUID form even when the caller passed the slug form", async () => {
        const { client, createChannelThread } = stubClient();
        // The caller addressed the channel BY SLUG, which is what makes this the
        // realistic shape: an agent that only ever saw a slug builds a key from it.
        await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Work", "do the thing", "bob@x.com", undefined, `${channel_handshake_key_1.HANDSHAKE_PREFIX}general-42`);
        (0, vitest_1.expect)(createChannelThread.mock.calls[0][1].clientMsgId).toBe(`${channel_handshake_key_1.HANDSHAKE_PREFIX}${CHANNEL.id}-42`);
    });
    (0, vitest_1.it)("TELLS the caller it rewrote the key, and what it would have cost", async () => {
        const { client } = stubClient();
        const text = (await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Work", "do the thing", "bob@x.com", undefined, `${channel_handshake_key_1.HANDSHAKE_PREFIX}general-42`)).content[0].text;
        (0, vitest_1.expect)(text).toContain("HANDSHAKE KEY REWRITTEN");
        (0, vitest_1.expect)(text).toContain(`${channel_handshake_key_1.HANDSHAKE_PREFIX}${CHANNEL.id}-42`);
        // The fact that makes the correction stick — not "we normalized your key".
        (0, vitest_1.expect)(text).toContain("403");
    });
    (0, vitest_1.it)("says nothing when the key was already right", async () => {
        const { client } = stubClient();
        const text = (await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Work", "do the thing", "bob@x.com", undefined, `${channel_handshake_key_1.HANDSHAKE_PREFIX}${CHANNEL.id}-42`)).content[0].text;
        (0, vitest_1.expect)(text).not.toContain("HANDSHAKE KEY REWRITTEN");
    });
    (0, vitest_1.it)("passes an ordinary idempotency key through untouched", async () => {
        const { client, createChannelThread } = stubClient();
        await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Work", "do the thing", "bob@x.com", undefined, "retry-7");
        (0, vitest_1.expect)(createChannelThread.mock.calls[0][1].clientMsgId).toBe("retry-7");
    });
    (0, vitest_1.it)("REFUSES a seq-less handshake key before anything is created", async () => {
        const { client, createChannelThread } = stubClient();
        const res = await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Work", "do the thing", "bob@x.com", undefined, `${channel_handshake_key_1.HANDSHAKE_PREFIX}general`);
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(createChannelThread).not.toHaveBeenCalled();
        const text = res.content[0].text;
        // Actionable: the shape, where the seq comes from, and the channel's id so
        // the retry does not have to go looking for it.
        (0, vitest_1.expect)(text).toContain(`${channel_handshake_key_1.HANDSHAKE_PREFIX}<channelId>-<seq>`);
        (0, vitest_1.expect)(text).toContain(CHANNEL.id);
        (0, vitest_1.expect)(text).toContain("no thread was opened");
    });
});
