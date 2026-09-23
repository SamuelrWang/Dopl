import { z } from "zod";
import type { AgentColorKey } from "@dopl/client";
import { err, type ToolResponse } from "./respond";

/**
 * **THE COLOUR-TAKEN REFUSAL** — the 409 `manage action="launch"` answers when the
 * caller named an agent colour another live agent in the channel already holds
 * (2026-09-13; docs/specs/agent-colors.md).
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-ops-launch.ts` IS AT THE CAP** (476 lines when
 * this landed; §1's hard 500 over `packages/` is a CI job). The seam is the one that
 * file already draws for its other refusals — the OP is the call and the hold, each
 * REFUSAL is prose about one server code — so this is the third such neighbour rather
 * than a new pattern.
 *
 * ⚠ **DUCK-TYPED ACROSS THE `@dopl/client` BOUNDARY**, the same discipline
 * `respond.ts › apiErrorCode`, `channel-ops-launch-identity.ts › identityMatches` and `respond.ts ›
 * isNotFound` follow: the error's `details` is a wire shape, not a class this package
 * imports, so it is read defensively and a malformed one degrades to "no list".
 */

/**
 * **THE SIXTEEN KEYS** — what `channel-schema.ts › CHANNEL_INPUT_SHAPE.color`
 * publishes as a `z.enum`, and the only spelling of the set in this package.
 *
 * ⚠ **A LIST RATHER THAN A REGEX, AND THE CHEAPER SHAPE WAS MEASURED AND REFUSED.**
 * `^agent-(0[1-9]|1[0-6])$` renders 80 chars into the served schema against this
 * list's 233 — but `tool-style.test.ts` forbids a published `pattern` outright,
 * because a character class is a contract the agent must reverse-engineer and its
 * failure is an opaque -32602. These members are rendered into the shape AND named in
 * the refusal.
 *
 * ⚠ **THE SAME SIXTEEN, IN THE SAME ORDER, AS FOUR OTHER SITES**:
 * `@dopl/contracts › AgentColorKey`, `src/features/channels/lib/agent-colors.ts ›
 * AGENT_COLOR_KEYS` (whose `satisfies` ties it to that union), and both column CHECKs
 * in `20261005120000_agent_session_colors.sql`. ⚠ **THIS COPY CANNOT IMPORT ANY OF
 * THEM**: `packages/` does not reach into `src/`, and `@dopl/contracts` is TYPE-ONLY
 * by rule — one runtime export makes it a build input for four toolchains. So it is a
 * hand-mirror, and **THE `satisfies readonly AgentColorKey[]` CLAUSE BELOW IS WHAT HOLDS
 * IT TO THE UNION** — a compile error, which is stronger than a test.
 * ⚠ **THIS SENTENCE NAMED `agent-color-wire.test.ts` UNTIL 2026-09-14 AND THAT FILE HAS
 * NEVER EXISTED** — `check-doc-refs.mjs` resolves anchors in `docs/`, not in source
 * comments, so the citation went unchecked. The MEMBERS and their order are pinned by
 * `channel-ops-launch-color.test.ts`; the SQL halves by
 * `src/features/channels/agent-color-schema.test.ts`.
 *
 * ⚠ ORDER IS THE BANK'S ORDER, because the refusal lists what is free and "the first
 * one in that list" must be the key the server would itself have picked.
 */
export const AGENT_COLOR_KEYS = [
  "agent-01", "agent-02", "agent-03", "agent-04",
  "agent-05", "agent-06", "agent-07", "agent-08",
  "agent-09", "agent-10", "agent-11", "agent-12",
  "agent-13", "agent-14", "agent-15", "agent-16",
] as const satisfies readonly AgentColorKey[];

/**
 * **THE TYPE BRIDGE FOR THE DISPATCH SEAM.**
 *
 * ⚠ **IT IS A NARROWING, NEVER A CAST.** The published `z.enum` already refuses
 * everything outside {@link AGENT_COLOR_KEYS}, so by the time
 * `channel-dispatch-agents.ts` reads `args.color` the value IS a key — but the arg
 * type flows from `CHANNEL_INPUT_SHAPE` through a `ZodObject` inference and arrives
 * widened. A cast would still compile the day the field widens for real; this would
 * not. Same discipline as `respond.ts › isNotFound`.
 *
 * ⚠ **`undefined` FOR ABSENT AND FOR UNRECOGNIZED ALIKE**, the choice
 * `lib/agent-colors.ts › agentColorOrNull` makes on the server: both mean "the server
 * picks the first free one", and there is no third behaviour to tell them apart with.
 */
export function asAgentColorKey(value: string | undefined): AgentColorKey | undefined {
  return value && (AGENT_COLOR_KEYS as readonly string[]).includes(value)
    ? (value as AgentColorKey)
    : undefined;
}

/** ⚠ SHAPE-CHECKED, NOT TRUSTED: a server older than the free-set change, or a
 *  transport that lost `details`, answers `[]` — and {@link colorTaken} then prints the
 *  short refusal rather than an empty bullet list. */
export function freeColors(e: unknown): string[] {
  const details = (e as { details?: unknown } | null)?.details;
  const raw = (details as { free?: unknown } | null)?.free;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string" && c.length > 0);
}

/**
 * ⚠ **`err`, BECAUSE NOTHING WAS FILED AND THERE IS NOTHING TO POLL** — the same
 * reason `ambiguousIdentity` is an error result. An `ok` here would invite a wait for a
 * directive that does not exist.
 *
 * ⚠ **THE LIST IS THE WHOLE VALUE OF THE REFUSAL** (`ambiguousIdentity`'s argument
 * again): "that colour is taken" alone leaves an orchestrator guessing among sixteen,
 * and the free set is already in the response.
 *
 * ⚠ **THE EMPTY-LIST CASE IS REAL AND IS NOT AN ERROR SHAPE OF ITS OWN**: a room with
 * all sixteen out. The honest instruction there is "omit the parameter" — a launch with
 * no colour still runs, and its posts wear the neutral box.
 *
 * ⚠ **IT TELLS THE CALLER TO REUSE THE SAME `client_msg_id`.** A retry is expected
 * here, and a fresh key on it would be the one way this refusal could end up filing two
 * directives.
 */
export function colorTaken(wanted: string, free: string[]): ToolResponse {
  const named = wanted ? `\`${wanted}\`` : "that colour";
  if (free.length === 0) {
    return err(
      `No agent was requested — ${named} is already held by a live agent in this channel, and **nothing was filed**. Every one of the sixteen colours is currently out, so there is none to move to: re-issue WITHOUT \`color\` and the agent runs uncoloured (its posts still read as an agent's), or wait for an agent to end and free one.`,
    );
  }
  return err(
    [
      `No agent was requested — ${named} is already held by a live agent in this channel, and **nothing was filed**. Colours are unique per channel across ALL members, so another member's agent may be wearing the one you asked for.`,
      `Re-issue with one of these, keeping the SAME \`client_msg_id\` so a retry cannot file twice:`,
      free.map((c) => `\`${c}\``).join(", "),
      `⚠ Or omit \`color\` entirely and the first free one is assigned — which is what you want unless the operator asked for a specific colour. A colour is only ever a marker, never a status.`,
    ].join("\n"),
  );
}

/**
 * **THE PUBLISHED `color` FIELD** — what `channel-schema.ts › CHANNEL_INPUT_SHAPE.color` is
 * (2026-09-13; docs/specs/agent-colors.md).
 *
 * ⚠ **IT IS DECLARED HERE RATHER THAN IN THE SHAPE FOR TWO REASONS AND THE SECOND IS THE
 * STRONGER ONE.** (1) §1's cap: `channel-schema.ts` was the largest file in `packages/` and was
 * OVER the cap when this landed, so 44 lines of field and argument there would have deepened an
 * existing overage. ⚠ **THAT OVERAGE IS GONE SINCE 2026-09-14** — F-689's three files were split
 * (`channel-vocab.ts`, `channel-schema-launch-fields.ts`) and `size-check` is green — so reason
 * (1) is now history rather than a live constraint; re-derive with `wc -l`, never quote.
 * (2) **ONE FILE, ONE RULE**: the sixteen keys,
 * the narrowing and the 409 that refuses a taken one already live here, and the published field
 * is the fourth face of the same rule. A colour change is now one file.
 *
 * ⚠ **AN ENUM, AND A `pattern` WAS TRIED AND IS FORBIDDEN.** The sixteen rendered as `enum`
 * members measure 233 chars served against 80 for `^agent-(0[1-9]|1[0-6])$`, and the 153 was
 * worth having — but `tool-style.test.ts › no published schema validates a date with a regex`
 * refuses ANY published `pattern`, on the rule that a character class is a contract the agent
 * must reverse-engineer and whose failure is an opaque -32602 rather than a sentence. An enum's
 * failure NAMES THE SIXTEEN. **The cheaper shape was measured and refused, not assumed.**
 *
 * ⚠ **THE DESCRIBE DOES NOT SPELL THE SET**, because the members are rendered into the served
 * shape right here — a prose copy of the vocabulary is the one cost this field could still shed.
 * ⚠ **AND THE STANDING RULES ARE IN THE PULLED DOCTRINE** (`channel-doctrine.ts › FIELDS`, whose
 * whole subject is an argument that carries a rule): uniqueness across members, the free-on-end
 * bank, the 409 and the retry key. On `identity`'s precedent they were WRITTEN there before they
 * were left out of here — a rule an agent needs once per launch does not belong on a surface
 * pushed to every client on every connection. `channel-schema.ts › SCHEMA_MAX_CHARS` records what
 * this field costs and what paid for it.
 * ⚠ IT IS IDENTITY, NEVER STATUS — the describe says so in five words, because an agent told that
 * colours exist will otherwise reach for one as a priority flag.
 */
export const AGENT_COLOR_FIELD = z
  .enum(AGENT_COLOR_KEYS)
  .optional()
  .describe(
    'op="manage" action="launch" (optional): the agent\'s COLOUR — a marker, never a status. Omit for the first free key; a taken one is a 409.',
  );
