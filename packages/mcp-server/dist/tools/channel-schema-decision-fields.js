"use strict";
/**
 * **THE `kind="decision"` FIELDS OF `dopl_channel`'s INPUT SHAPE** — `options` and
 * `recommendation`, the two params that turn a send into a card a person answers in one press.
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-schema.ts` IS AT THE CAP** (§1's hard 500 over
 * `packages/`, the `size-check` CI job) — the precedent is `channel-schema-launch-fields.ts`,
 * split out on 2026-09-14 for the same reason, and the seam is the same one: a COHERENT GROUP
 * of fields that move together. These two are one feature and nothing else on the surface
 * reads them; `options` without `recommendation` is a card with no advice, and
 * `recommendation` without `options` is an index into nothing.
 *
 * ⚠ **SPREAD INTO `CHANNEL_INPUT_SHAPE` IN ITS ORIGINAL POSITION, so the PUBLISHED SCHEMA IS
 * BYTE-IDENTICAL.** Key order survives an object spread, and the served shape is measured to
 * the character (`channel-schema-budget.test.ts`, `tool-budget.test.ts`) — a split that moved
 * one byte would read as a budget change and get argued about as one.
 *
 * ⚠ **EVERY `.describe()` HERE IS PUSHED ON EVERY CONNECTION** and is budgeted exactly as the
 * parent file's are. The rules those sentences do not carry are in `channel-doctrine.ts`,
 * which is PULLED — see `channel-schema.ts`'s header for the whole argument.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan (`parity.test.ts`) and the
 * removed-vocabulary source scan (`channel-law.test.ts`, `law-scan.test.ts`) — both read every
 * non-test `channel-*.ts` in this directory.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECISION_INPUT_FIELDS = void 0;
const zod_1 = require("zod");
exports.DECISION_INPUT_FIELDS = {
    // ⚠ TWO SEPARATE PARAMS RATHER THAN ONE `escalation` OBJECT, deliberately. The whole point
    // of the kind is that an agent has to SAY these things; a nested object lets a model fill
    // one key with a paragraph and satisfy the schema. The other two fields it used to need are
    // gone because the surface already had them: the ISSUE is `summary`, the CONTEXT is `body`.
    // Caps mirror `src/features/channels/escalation.ts` — sync all three (that file, this one,
    // `channel-errors.ts › fieldCapsNote`).
    options: zod_1.z
        .array(zod_1.z.object({
        label: zod_1.z
            .string()
            .trim()
            .min(1)
            .max(80)
            .describe("The button's face — one short imperative."),
        consequence: zod_1.z
            .string()
            .trim()
            .min(1)
            .max(200)
            .describe("ONE line saying what happens if they press it. Required on every option."),
    }))
        .min(2)
        .max(6)
        .optional()
        .describe(
    // ⚠ "One option is not a question" WAS THE PROSE COPY OF `.min(2)`, which
    // the published schema enforces and states as `minItems`. The doctrine's
    // `send` section carries the shape of a card ("`options` 2-6 choices each
    // with its consequence"), so the rule is both enforced and taught.
    'op="send" with kind="decision" (required): 2-6 things a person could decide, each with the consequence of choosing it.'),
    recommendation: zod_1.z
        .object({
        index: zod_1.z
            .number()
            .int()
            .min(0)
            .describe("0-based index into `options` — the one you would take."),
        why: zod_1.z.string().trim().min(1).max(200).describe("ONE line for why."),
    })
        .optional()
        .describe(
    // ⚠ ITS OWN TWO PROPERTIES SAY WHAT IT IS — `index` "the one you would
    // take", `why` "ONE line for why" — and both are pushed on the same
    // connection as this line was. What only the parent can say is the
    // cross-field rule, which is what is left.
    'op="send" with kind="decision" (optional but almost always right): `index` MUST be inside `options` — an out-of-range one refuses the whole call.'),
};
