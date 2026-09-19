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
import { z } from "zod";
export declare const DECISION_INPUT_FIELDS: {
    options: z.ZodOptional<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        consequence: z.ZodString;
    }, z.core.$strip>>>;
    recommendation: z.ZodOptional<z.ZodObject<{
        index: z.ZodNumber;
        why: z.ZodString;
    }, z.core.$strip>>;
};
