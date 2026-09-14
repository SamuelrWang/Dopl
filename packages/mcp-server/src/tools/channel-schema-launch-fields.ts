/**
 * THE `op="manage" action="launch"` SHAPE FIELDS — `model`, `template`, `color`, `posture`.
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-schema.ts` WAS OVER THE 500-LINE CAP** (§1; the
 * `size-check` CI job and `max-lines` in `eslint.config.mjs`, F-689), and this is the seam
 * `channel-ops-launch-color.ts` already drew one field at a time: the launch lane's arguments
 * change together and change for a different reason from the send/read ones.
 *
 * ⚠ **SPREAD INTO `CHANNEL_INPUT_SHAPE` IN ITS ORIGINAL POSITION — LAST — SO THE PUBLISHED
 * SCHEMA IS BYTE-FOR-BYTE WHAT IT WAS.** `channel-schema-budget.test.ts › SCHEMA_MAX_CHARS`
 * and `tool-budget.test.ts` both fail in BOTH directions, so a move that changed one served
 * character would fail rather than pass quietly.
 *
 * ⚠ THE BUDGET ARGUMENT FOR EVERY `.describe()` BELOW IS STATED ONCE, at
 * `channel-schema.ts › SCHEMA_MAX_CHARS`, and is not restated here.
 */

import { z } from "zod";
// ⚠ THE SET, FROM THE MODULE THAT ALSO OWNS ITS REFUSAL — one file, one rule.
import { AGENT_COLOR_FIELD } from "./channel-ops-launch-color";

export const LAUNCH_INPUT_FIELDS = {

  // ── op="manage" action="launch" ──────────────────────────────────────────
  model: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe(
      // ⚠ Its silent-fallback sentence moved to `channel-doctrine.ts › MANAGE` (2026-09-13; why:
      // `SCHEMA_MAX_CHARS`).
      'op="manage" action="launch" (optional): the model to run the agent on. Omit it for whatever the operator set for that channel.',
    ),

  // ⚠ ID **OR** EXACT NAME, in ONE param — `dopl_kb`'s `base` already works this
  // way (`knowledge-shared.ts`), so this reuses the tree's idiom rather than
  // inventing a second convention.
  template: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe(
      // ⚠ THE AMBIGUITY REFUSAL MOVED TO THE DOCTRINE'S `manage` SECTION, beside
      // the rest of the launch contract and the refusal table it belongs to. It
      // is the one genuine MOVE in this slice — the sentence had no second home,
      // so it was WRITTEN there before it was cut here.
      // ⚠ "THIS CHANNEL'S container" IS PINNED on this describe by
      // `channel-ops-launch-body.test.ts:232` and stays verbatim.
      'op="manage" action="launch" (optional): the AGENT TEMPLATE the new agent runs as — its id, or its exact name. It resolves in THIS CHANNEL\'S container under THE OPERATOR\'S visibility. Omit it to start a blank agent.',
    ),

  // ⚠ Declared in `channel-ops-launch-color.ts` (one file, one rule; §1's cap). Argument there.
  color: AGENT_COLOR_FIELD,

  // ── ⚠ THE PERMISSION AXES, IN ONE OBJECT (B8; 2026-09-01's T24 axes) ───────
  //
  // ⚠ **ONE PARAM BECAUSE THE CODE ALREADY TREATS THEM AS ONE THING** —
  // `channel-facts.ts › postureFacts` renders the trio together, the desktop
  // clamps them together, and `action="posture"` exists to set them together.
  // Three top-level params for one concept is what made this shape 35 fields.
  // ⚠ **THE ENUM MEMBERS ARE ORDERED NARROWEST FIRST AND THAT ORDER IS THE
  // CONTRACT.** The operator's machine clamps by INDEXING into a copy of these
  // sequences, so re-ordering either one silently inverts the bound.
  // ⚠ **`chain` HAS THREE VALUES BECAUSE THERE ARE THREE STATES** (C11): it was
  // an optional boolean whose describe had to spend a paragraph saying that
  // omitting it was NOT `false`, and that exact confusion was a live wire bug
  // (GAP C: `directiveFrom` flattened `false` to `null`).
  posture: z
    .object({
      tools: z
        .enum(["manual", "accept_edits", "auto", "bypass"])
        .optional()
        .describe(
          "How much TOOL freedom to ask for — values ordered narrowest first.",
        ),
      messages: z
        .enum(["ask", "auto_inbound", "auto_outbound", "auto_both"])
        .optional()
        .describe(
          "How much MESSAGE freedom to ask for — narrowest first, floored for a windowless session.",
        ),
      chain: z
        .enum(["inherit", "on", "off"])
        .optional()
        .describe(
          'Launch only: may the new agent launch further agents? "on" is REFUSED rather than quietly narrowed when the channel forbids it.',
        ),
    })
    .optional()
    .describe(
      // ⚠ **THE CLAMP SENTENCE IS PINNED BY PHRASE AND MAY NOT MOVE TO THE PULLED DOCTRINE** —
      // `channel-ops-agent-mode.test.ts` / `channel-session-handle.test.ts` assert
      // `narrows whatever you ask for to their own ceiling` here; it is the only place a caller
      // learns its ASK is not the SET before it asks (moved 2026-09-13, both suites caught it).
      'op="manage" action="launch" / action="posture" (optional): how much freedom to ASK FOR. Your operator\'s machine narrows whatever you ask for to their own ceiling and never widens past it; omit an axis to run at that setting.',
    ),
};
