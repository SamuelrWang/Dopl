"use strict";
/**
 * THE `op="rooms"` LANE'S FIELDS — their own module since 2026-09-18, for the
 * same reason `channel-schema-launch-fields.ts` is one: `channel-schema.ts` sits
 * AT §1's 500-line cap (the `size-check` CI job, F-689), so a parameter that
 * grows by a line has nowhere to grow.
 *
 * ⚠ **THE SEAM IS A REASON TO CHANGE.** These five move when the ROOMS lane
 * moves; the recipient, send and read fields move for their own reasons. Nothing
 * else is in here and nothing here is re-exported under a second name.
 *
 * ⚠ **SPREAD IN THEIR ORIGINAL POSITION** by `channel-schema.ts`, so the
 * PUBLISHED SCHEMA IS UNCHANGED — not one served character moved with the file.
 * `channel-schema-budget.test.ts` measures the composed shape, so a drift here
 * fails there rather than passing quietly.
 *
 * ⚠ Every `.describe()` here is PUSHED on every connection and is held to
 * `channel-schema.ts › PARAM_DESCRIPTION_MAX_CHARS`. A RULE belongs in
 * `channel-doctrine.ts › ROOMS`, which is PULLED by the agent that asks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROOMS_INPUT_FIELDS = void 0;
const zod_1 = require("zod");
const channel_doctrine_1 = require("./channel-doctrine");
exports.ROOMS_INPUT_FIELDS = {
    // ⚠ `name` SERVES FOUR ACTIONS AND THEY ARE ALL LABELS, which is why one field carries
    // them. ⚠ **"Neither addresses anything" CLOSED THAT SENTENCE AND WAS FALSE** (corrected
    // 2026-09-15): the name has been an ADDRESS in all three trees since 2026-08-28, while the
    // describe pushed *"nothing resolves an agent by its name"* to every client, every connection.
    name: zod_1.z
        .string()
        .optional()
        .describe(
    // ⚠ THE 1:1 CLAUSE CAME OFF ON 2026-09-06 TO PAY FOR THE ARTIFACT ONE: `to`'s describe
    // already says op="rooms" takes it for the 1:1, and both ride the same connection.
    // ⚠ **AND IT TEACHES TITLE CASE RATHER THAN "slugged" SINCE 2026-09-17** — that word read
    // as an instruction to PASS `picker-fix`. The tag is DERIVED, and
    // `agent-display-name.ts` repairs a slug that arrives anyway.
    'op="rooms" action="open" (required for a NAMED channel): the channel name. op="manage" action="launch" (REQUIRED), action="rename": what to call that agent — a DISPLAY NAME in Title Case ("Picker Fix" → `@picker-fix`), never a slug. 1-60 visible characters on ONE line, an id is not a name, "" clears; a launch answers the name it GOT — read `name=`. op="artifact" action="create": the card\'s name.'),
    visibility: zod_1.z
        .enum(["private", "public"])
        .optional()
        .describe('op="rooms" action="open" (optional): "private" (default, invite-only) or "public" (any workspace member can see and join).'),
    mode: zod_1.z
        .enum(["interactive", "autonomous"])
        .optional()
        .describe('op="rooms" action="thread_mode" (required): the thread execution mode.'),
    info_card: zod_1.z
        .object({
        hidden: zod_1.z
            .array(zod_1.z.string())
            .max(3)
            .optional()
            .describe('Built-in rows to HIDE, by key: "email", "created", "lastActivity".'),
        rows: zod_1.z
            .array(zod_1.z.object({
            id: zod_1.z
                .string()
                .max(64)
                .optional()
                .describe("Omit on a NEW row (one is minted for you); pass it to EDIT the row that already has it. Unique within a card."),
            label: zod_1.z
                .string()
                .min(1)
                .max(40)
                .describe("The left column — one short line."),
            value: zod_1.z
                .string()
                .max(200)
                .optional()
                .describe("The right column. May be empty."),
        }))
            .max(12)
            .optional()
            .describe("The card's CUSTOM rows."),
    })
        .optional()
        .describe(
    // ⚠ Its "everyone sees it" moved to `channel-doctrine.ts › ROOMS` (2026-09-13; why:
    // `SCHEMA_MAX_CHARS`).
    'op="rooms" action="update": the channel\'s whole info card, REPLACED — an omitted row is DELETED and `info_card={}` clears the card. Omit the argument entirely to READ the card unchanged.'),
    // ⚠ **THE DOCTRINE IS PULLED, SO IT MUST BE PULLABLE IN PIECES** (2026-09-02).
    // Help returned the whole document or nothing, which makes the one surface
    // designed to be read on demand too expensive to read on demand. The names
    // come from `channel-doctrine.ts › DOCTRINE_SECTIONS`, so an unknown one is a
    // -32602 naming this field rather than a silently empty answer.
    section: zod_1.z
        .enum(channel_doctrine_1.DOCTRINE_SECTION_NAMES)
        .optional()
        .describe('op="rooms" action="help" (optional): ONE section instead of the whole document. Omit for everything, index of section names included.'),
};
