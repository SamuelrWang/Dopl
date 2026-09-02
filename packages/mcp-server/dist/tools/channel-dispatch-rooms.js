"use strict";
/**
 * `op="rooms"` — WHAT THIS PLACE IS, and the four acts that change it.
 *
 * ⚠ **EIGHT OLD OPS, ONE DISPATCHER** (B8, 2026-09-02): `list`, `open`,
 * `invite`, `members`, `list_threads`, `set_thread_mode`, `update` and `help`
 * were eight top-level names for one question — the ROOM, rather than the
 * conversation in it. `read` answers "what was said", `status` "what is
 * running", and this answers "what is this place, and who is in it".
 *
 * ⚠ **FOUR OF THE EIGHT WRITE, AND THE GATE IS PER ACTION** (`gating.ts ›
 * WRITE_OPS` names `rooms.open`, `rooms.invite`, `rooms.thread_mode` and
 * `rooms.update`). Classifying the whole op as a write would refuse a
 * `dopl.read` token the four calls it exists to make — listing its channels
 * among them — and classifying it as a read would hand one the four that
 * change the room. Neither is a scoping; both are holes.
 *
 * ⚠ `channel-` filename prefix is REQUIRED: the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`law-scan.test.ts`) read every non-test `channel-*.ts` in this directory.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRoomsAction = isRoomsAction;
exports.dispatchRoomsAction = dispatchRoomsAction;
const respond_1 = require("./respond");
const channel_doctrine_1 = require("./channel-doctrine");
const channel_schema_1 = require("./channel-schema");
const channel_ops_read_1 = require("./channel-ops-read");
const channel_ops_open_1 = require("./channel-ops-open");
const channel_ops_threads_1 = require("./channel-ops-threads");
const channel_ops_update_1 = require("./channel-ops-update");
/**
 * True for an action this module answers. ⚠ **THE ONE PLACE THE PAIRING IS
 * CHECKED**, and it exists because `action` is ONE flat enum over two
 * vocabularies: `rooms` must not answer `launch`, and `manage` must not answer
 * `open`. The two lists are disjoint, so membership settles the pair.
 */
function isRoomsAction(action) {
    return channel_schema_1.CHANNEL_ACTIONS.rooms.includes(action);
}
async function dispatchRoomsAction(action, args, client, selfUserId, isAdmin) {
    switch (action) {
        case "list":
            return (0, channel_ops_read_1.opList)(client);
        // ⚠ THE DOCTRINE DOOR. Returns a CONSTANT and makes no request at all — the
        // same text as the MCP resource `dopl://doctrine/channels`, for a client
        // that lists tools and never reads resources, so the rules can never be
        // unreachable. ⚠ `section` NARROWS and never changes what is true: an
        // unknown name cannot reach here, because the schema's enum is built from
        // the same table, so there is no not-found arm to write or to get wrong.
        case "help":
            return (0, respond_1.ok)(args.section === undefined
                ? channel_doctrine_1.CHANNEL_DOCTRINE
                : (0, channel_doctrine_1.doctrineSection)(args.section));
        // ⚠ WHICH ROOM IS READ OFF THE SHAPE, NOT OFF A FLAG (C12, 2026-09-02).
        // `direct: true` was a third thing to get right beside the two arguments
        // that already said everything: a 1:1 has a recipient and no `name`, a named
        // channel has a `name` and no recipient, and the flag could contradict
        // either. Both together is the one ambiguous call, and it is REFUSED rather
        // than resolved by precedence — a caller that meant one of them cannot tell
        // which it got.
        case "open": {
            if (args.to !== undefined && args.name !== undefined) {
                return (0, respond_1.err)('op="rooms" action="open" takes `name` (a named channel) or `to` (a direct 1:1), never both — nothing was opened. Drop `to` to open a channel, or drop `name` to open the DM.');
            }
            if (args.to !== undefined) {
                return (0, channel_ops_open_1.opOpen)(client, { direct: true, member: args.to });
            }
            const miss = (0, respond_1.missingParams)('rooms action="open"', args, ["name"]);
            if (miss)
                return miss;
            return (0, channel_ops_open_1.opOpen)(client, {
                name: args.name,
                // ⚠ **THE TOPIC IS `summary` (B8).** One field carries "the one-line
                // intent" everywhere on this surface — a thread's title, a send's
                // notification line, a decision's question — and a room's topic is the
                // same sentence about a room. A second name for it was a param.
                topic: args.summary,
                visibility: args.visibility,
            });
        }
        case "invite": {
            const miss = (0, respond_1.missingParams)('rooms action="invite"', args, [
                "channel",
                "to",
            ]);
            if (miss)
                return miss;
            return (0, channel_ops_open_1.opInvite)(client, args.channel, args.to);
        }
        case "members": {
            const miss = (0, respond_1.missingParams)('rooms action="members"', args, ["channel"]);
            if (miss)
                return miss;
            // ⚠ Admin flag gates member EMAIL in the roster render.
            return (0, channel_ops_read_1.opMembers)(client, args.channel, selfUserId, isAdmin);
        }
        case "threads": {
            const miss = (0, respond_1.missingParams)('rooms action="threads"', args, ["channel"]);
            if (miss)
                return miss;
            return (0, channel_ops_read_1.opListThreads)(client, args.channel, selfUserId);
        }
        case "thread_mode": {
            const miss = (0, respond_1.missingParams)('rooms action="thread_mode"', args, [
                "channel",
                "thread",
                "mode",
            ]);
            if (miss)
                return miss;
            return (0, channel_ops_threads_1.opSetThreadMode)(client, args.channel, args.thread, args.mode);
        }
        // ⚠ THE INFO CARD ONLY. `name` / `topic` / `archived` are accepted by the
        // same route and are deliberately NOT routed here (Samuel's ruling Q12 (b);
        // F-346 holds the rename hole open). ⚠ `info_card` OMITTED is the READ — the
        // card is replaced whole, so a blind write clobbers.
        case "update": {
            const miss = (0, respond_1.missingParams)('rooms action="update"', args, ["channel"]);
            if (miss)
                return miss;
            return (0, channel_ops_update_1.opUpdate)(client, args.channel, args.info_card);
        }
    }
}
