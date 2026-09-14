"use strict";
/**
 * THE `dopl_channel` VOCABULARY — the OPS an agent may pick from, the per-op ACTION lists,
 * and the two refusals written from them.
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-schema.ts` IS THE LARGEST FILE IN `packages/` AND WAS
 * OVER THE 500-LINE CAP** (§1; the `size-check` CI job and `max-lines` in
 * `eslint.config.mjs`, F-689). The seam is a REASON TO CHANGE, not a line count: a word in
 * these lists changes when an OP is added or retired, and the shape next door changes when a
 * PARAMETER does. ⚠ It is also the seam `channel-ops-launch-color.ts` already drew for the
 * colour rule — one file, one rule.
 *
 * ⚠ **RE-EXPORTED UNCHANGED FROM `channel-schema.ts`, SO NO IMPORTER MOVED**, and the file
 * keeps the `channel-` prefix `tool-group-files.ts` discovers the tool's source by — an
 * unprefixed name is invisible to every parity and law scan.
 *
 * ⚠ NO `zod` HERE, deliberately: these are `as const` string lists and the functions written
 * from them. The published shape that spends them lives in `channel-schema.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_ACTION_NAMES = exports.CHANNEL_ACTIONS = exports.CHANNEL_OPS = void 0;
exports.unknownOpRefusal = unknownOpRefusal;
exports.unknownActionRefusal = unknownActionRefusal;
/**
 * THE SIX OPS AN AGENT SEES, and the only six it may pick from.
 *
 * ⚠ THE ORDER IS THE READING ORDER a model skims: the one write it makes most, the two reads,
 * then the three dispatchers.
 *
 * ⚠ **`artifact` IS THE SIXTH, ADDED 2026-09-06 (design #1220 §5, accepted at #1222), AND IT IS
 * AN OP RATHER THAN A `send` KIND** — it writes no message. It folds messages that ALREADY EXIST
 * into one card, which is a different verb on a different row, and hanging it off the send lane
 * would have put a non-delivery on the one op whose whole contract is that it delivers.
 */
exports.CHANNEL_OPS = [
    "send",
    "read",
    "status",
    "manage",
    "rooms",
    "artifact",
];
/**
 * THE ONE REFUSAL FOR A WORD THAT IS NOT AN OP, written once and used twice (slice B16): the
 * schema's own zod error, and `channel.ts`'s exhaustive `default` for a build where that
 * validation did not run.
 *
 * ⚠ **WITHOUT IT, RETIREMENT IS A `-32602 invalid enum value`** — the opaque failure B8's one-
 * release redirect window existed to prevent, arriving one release later. ⚠ **ONE LINE, AND IT
 * NAMES THE WHOLE VOCABULARY** — six words since `artifact` landed (A4, 2026-09-06), derived from
 * {@link CHANNEL_OPS} and never counted here; anything longer is `rooms(action="help")`'s
 * doctrine.
 *
 * ⚠ The caller's own word is echoed BOUNDED AND ON ONE LINE — it is the only part of this
 * sentence they wrote, and an unbounded multi-line echo is structure a caller can forge inside
 * our narration.
 */
function unknownOpRefusal(op) {
    const raw = typeof op === "string" ? op : (JSON.stringify(op) ?? String(op));
    const shown = raw.replace(/\s+/g, " ").slice(0, 40);
    // ⚠ Same sentence shape as the two `action` refusals in `channel.ts` — one
    // vocabulary, listed and then joined with "or", derived from the enum so a
    // sixth op cannot arrive without appearing here.
    const quoted = exports.CHANNEL_OPS.map((o) => `"${o}"`);
    const offered = `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
    return `dopl_channel has no op "${shown}" — it takes ${offered}. Nothing was done.`;
}
/**
 * THE SUB-VERBS, per dispatching op.
 *
 * ⚠ **THE THREE VOCABULARIES ARE DISJOINT BY CONSTRUCTION**, and a test asserts it: one flat
 * `action` enum is what a client introspects, so an overlapping word would make the same string
 * mean two things one op apart. Disjointness is also what lets `gating.ts › WRITE_OPS` name a
 * single write action (`rooms.open`) without the pair ever being ambiguous.
 *
 * ⚠ **THE THIRD LIST ARRIVED WITH `artifact` (2026-09-06) AND THE DISJOINTNESS RULE IS WHY ITS
 * WORDS ARE WHAT THEY ARE.** `create` was the obvious name for opening a room too, and `open` for
 * a card; both were rejected here rather than disambiguated later, because the pairing refusals
 * below can only say "that word belongs to <op>" while every word belongs to exactly one.
 *
 * ⚠ **`rooms` CARRIES BOTH READS AND WRITES, AND THAT IS WHY THE WRITE GATE IS PER-ACTION.**
 * Classifying the whole op as a write would refuse a read-only token the very calls it exists to
 * make — `list`, `members`, `help` — and classifying it as a read would open `open` / `invite` /
 * `update` to one.
 */
exports.CHANNEL_ACTIONS = {
    manage: ["launch", "end", "rename", "posture", "direct"],
    rooms: [
        "list",
        "open",
        "invite",
        "members",
        "threads",
        "thread_mode",
        "update",
        "help",
    ],
    // ⚠ FOUR ACTS, AND `dissolve` IS NOT A DELETE — it clears the column from
    // every member and retires the card, leaving every body, author and `seq`
    // exactly where it was. That is what keeps a fold reversible, and it is why
    // this op sits inside the tool's published "no delete op" policy.
    artifact: ["create", "add", "remove", "dissolve"],
};
/** Every action name, as the published enum. ⚠ Derived, never restated. */
exports.CHANNEL_ACTION_NAMES = [
    ...exports.CHANNEL_ACTIONS.manage,
    ...exports.CHANNEL_ACTIONS.rooms,
    ...exports.CHANNEL_ACTIONS.artifact,
];
/**
 * THE ONE REFUSAL FOR A WORD THAT BELONGS TO ANOTHER OP — written once here, used by all three
 * dispatch arms in `channel.ts`.
 *
 * ⚠ **IT WAS TWO HAND-WRITTEN SENTENCES UNTIL 2026-09-06, AND THE THIRD VOCABULARY IS WHY IT IS
 * DERIVED NOW.** Each arm said "that word belongs to" and then NAMED the other op, which is a
 * claim only true while there are exactly two lists: the moment `artifact` arrived,
 * `manage(action="create")` would have told the caller to try `rooms`, confidently and wrongly.
 * The owner is looked up in the same table the enum is built from, so a fourth vocabulary cannot
 * make this sentence lie.
 *
 * ⚠ The offered list is the op's OWN vocabulary, joined with "or" — the same shape as {@link
 * unknownOpRefusal}, and the one thing a caller cannot read off a flat `action` enum that
 * publishes all three lists as one.
 */
function unknownActionRefusal(op, action) {
    const shown = action.replace(/\s+/g, " ").slice(0, 40);
    const owner = Object.keys(exports.CHANNEL_ACTIONS).find((candidate) => candidate !== op &&
        exports.CHANNEL_ACTIONS[candidate].includes(action));
    // ⚠ THE OWNER CLAUSE IS OMITTED RATHER THAN GUESSED when no vocabulary has
    // the word. Unreachable through the published schema — `action` is an enum
    // over all three lists — and kept for the same reason `channel.ts` keeps its
    // exhaustive default: a build where that validation did not run must refuse,
    // and must not invent an op to send the caller to.
    const belongs = owner ? ` — that word belongs to op="${owner}"` : "";
    const quoted = exports.CHANNEL_ACTIONS[op].map((a) => `"${a}"`);
    const offered = `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
    return `op="${op}" has no action "${shown}"${belongs}. Nothing was done. op="${op}" takes ${offered}.`;
}
