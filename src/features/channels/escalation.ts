import { z } from "zod";
import { safeLabel, safeOptionalProse } from "@/shared/lib/safe-label";

/**
 * A STRUCTURED ESCALATION — an agent's question to a human, as STRUCTURE rather
 * than a prose wall (Samuel, 2026-08-31).
 *
 * Four fields and no more: the ISSUE in one line, bounded CONTEXT, 2–6 OPTIONS
 * each carrying a one-line consequence, and an optional RECOMMENDATION naming
 * one of them with a reason. The operator reads the card, presses an option, and
 * the choice is routed back to the asking agent as its answer.
 *
 * ⚠ ONE MODULE, FOUR CONSUMERS, AND THAT IS WHY IT IS NOT UNDER `server/` —
 * `info-card.ts`'s reason verbatim. The route's zod schema, the metadata
 * stamper, the transcript's row builder and the SPA's card all need the same
 * answer to "what is an escalation", and the desktop renderer's ESLint fence
 * blocks every `features/<x>/server/` path, so a `server/` home would buy a
 * second copy over there.
 *
 * ⚠ THE PAYLOAD IS RESERVED METADATA, ON `fanoutGroup`'s EXACT TERMS
 * (INVARIANTS §5). {@link ESCALATION_METADATA_KEY} is stripped from caller input
 * unconditionally in `server/service-writes-metadata.ts › resolvePostMetadata`
 * and re-stamped ONLY from the validated `escalation` field on
 * `schema.ts › ChannelMessageCreateSchema`. The card renders OPTION BUTTONS that
 * write back and wake an agent, so a caller-settable key would let anybody hang
 * a working control off anybody's words.
 *
 * ⚠ IT RIDES `kind: 'message'` AND MUST KEEP DOING SO. Three reasons, any one
 * sufficient: `dopl-desktop-app/main/targeting.js › classify` returns `ignore`
 * for every `m.kind !== 'message'`, so a card on any other kind can never
 * notify anybody; the six `kind` values are a column CHECK plus four
 * hand-mirrored unions and every one of those lanes is already owned; and the
 * transcript's own card precedent is metadata-keyed rather than kind-keyed
 * (`components/channels-v2/view-model.ts › threadIdOf`).
 *
 * ⚠ THE MESSAGE `body` STILL CARRIES THE HUMAN-READABLE RENDER, per
 * `schema.ts › ChannelMessageCreateSchema`'s own contract. That is what makes
 * the card DEGRADE rather than vanish: a build that does not know this key — an
 * older desktop, `dopl_channel(op="read")`, a plain browser, the pop-out — shows
 * the same words a prose escalation would have had. A card whose absence leaves
 * a blank row is not shippable.
 */

/** ISSUE — one line, and it is the card's title. A LABEL by `safe-label.ts`'s
 *  rule: spliced into chrome we wrote, never rendered as its own prose. */
export const ESCALATION_ISSUE_MAX = 200;
/** CONTEXT — the one genuinely prose field, so newlines are legal here and
 *  nowhere else on the card. Bounded because "bounded context" is the ruling. */
export const ESCALATION_CONTEXT_MAX = 2000;
/** One option's LABEL — the button's face. */
export const ESCALATION_OPTION_LABEL_MAX = 80;
/** One option's CONSEQUENCE — the muted line under the button. One line. */
export const ESCALATION_CONSEQUENCE_MAX = 200;
/** The recommendation's reason. One line, beside the option it names. */
export const ESCALATION_WHY_MAX = 200;

/**
 * ⚠ 2–6, AND BOTH ENDS ARE THE RULING. One option is a statement, not a
 * question — an agent with one path forward should take it and report, which is
 * what `op="milestone"` is for. Seven is the prose wall in a costume, and a card
 * that scrolls is not a card.
 */
export const ESCALATION_MIN_OPTIONS = 2;
export const ESCALATION_MAX_OPTIONS = 6;

/** The reserved metadata key carrying the escalation payload. */
export const ESCALATION_METADATA_KEY = "escalation";
/** The reserved metadata key carrying an ANSWER to one. */
export const ESCALATION_ANSWER_METADATA_KEY = "escalationAnswer";

/** One choice the operator may press, and what pressing it costs. */
export interface ChannelEscalationOption {
  label: string;
  consequence: string;
}

/** Which option the agent would take, and why. `index` is into `options`. */
export interface ChannelEscalationRecommendation {
  index: number;
  why: string;
}

/**
 * The stamped payload.
 *
 * ⚠ READONLY, because every reader takes it straight off a shared query-cache
 * entry (INVARIANTS §8: patches operate on the raw response body) and an
 * in-place edit would rewrite a row other components are mid-render over.
 */
export interface ChannelEscalation {
  readonly issue: string;
  readonly context: string;
  readonly options: readonly ChannelEscalationOption[];
  readonly recommendation: ChannelEscalationRecommendation | null;
}

/**
 * The stamped ANSWER, on the answering member's own message.
 *
 * ⚠ `agentId` IS THE WAKE KEY, AND IT IS WHY THIS IS METADATA RATHER THAN AN
 * `@agent-<id>` TOKEN IN THE BODY. The raw agent id is never user-visible
 * chrome (INVARIANTS §11 — the one exception is an agent's own output), and a
 * PEER's machine cannot know the asking agent's display name, so the body token
 * is the only form available to them and it is the forbidden one. A
 * server-stamped key is also strictly less forgeable than a token any member can
 * type. ⚠ `null` when the escalation carried no instance stamp — the answer is
 * still an ordinary visible message, so `main/session-dispatch.js ›
 * feedLiveSession` still delivers it to every LIVE agent on the thread.
 */
export interface ChannelEscalationAnswer {
  /** The `channel_messages.id` of the escalation being answered. */
  readonly escalationMessageId: string;
  /** Index into that escalation's `options`. */
  readonly optionIndex: number;
  /** The asking agent instance, when the escalation was stamped with one. */
  readonly agentId: string | null;
}

const OptionSchema = z.object({
  label: safeLabel("An escalation option", ESCALATION_OPTION_LABEL_MAX),
  consequence: safeLabel(
    "An escalation option consequence",
    ESCALATION_CONSEQUENCE_MAX
  ),
});

/**
 * What `POST /api/channels/[channelId]/messages` accepts for `escalation`.
 *
 * ⚠ AN OUT-OF-RANGE `recommendation.index` IS A 400, NOT A DROPPED FIELD. A
 * dropped one renders a card that recommends nothing, silently, over an agent
 * that believes it recommended something — the narrate-success-over-invisible-
 * failure shape `strictInput` exists to refuse one layer up.
 */
export const ChannelEscalationSchema = z
  .object({
    issue: safeLabel("An escalation issue", ESCALATION_ISSUE_MAX),
    // ⚠ PROSE, so newlines are legal. It is rendered as itself in a body block,
    // never spliced into a line we wrote.
    context: safeOptionalProse("Escalation context", ESCALATION_CONTEXT_MAX),
    options: z
      .array(OptionSchema)
      .min(ESCALATION_MIN_OPTIONS)
      .max(ESCALATION_MAX_OPTIONS),
    recommendation: z
      .object({
        index: z.number().int().min(0),
        why: safeLabel("An escalation recommendation", ESCALATION_WHY_MAX),
      })
      .nullable()
      .optional(),
  })
  .refine(
    (e) => e.recommendation == null || e.recommendation.index < e.options.length,
    { error: "Escalation recommendation index is outside the options list" }
  );

export type ChannelEscalationInput = z.infer<typeof ChannelEscalationSchema>;

/**
 * What the same route accepts for `escalationAnswer`.
 *
 * ⚠ `agentId` IS NOT ACCEPTED FROM THE CALLER. It is re-derived server-side off
 * the escalation message's own `client_msg_id` stamp, so an answer cannot name
 * an agent the escalation was not written by — which would make this key a wake
 * primitive aimed anywhere. Same discipline as `to_user_id`.
 */
export const ChannelEscalationAnswerSchema = z.object({
  escalationMessageId: z.string().uuid(),
  optionIndex: z.number().int().min(0).max(ESCALATION_MAX_OPTIONS - 1),
});

export type ChannelEscalationAnswerInput = z.infer<
  typeof ChannelEscalationAnswerSchema
>;

/**
 * A stored `metadata.escalation` value → a payload, defensively.
 *
 * ⚠ IT NEVER THROWS AND IT ANSWERS `null` RATHER THAN A DEFAULT. `info-card.ts ›
 * parseInfoCard` degrades to the card as shipped because a channel with no card
 * is a normal channel; there is no such thing as an empty escalation, so the
 * honest degraded answer is "this row is not one" and the caller renders the
 * body it already has.
 */
export function parseEscalation(raw: unknown): ChannelEscalation | null {
  if (raw === null || typeof raw !== "object") return null;
  const parsed = ChannelEscalationSchema.safeParse(raw);
  if (!parsed.success) return null;
  return Object.freeze({
    issue: parsed.data.issue,
    context: parsed.data.context,
    options: Object.freeze(parsed.data.options.map((o) => Object.freeze({ ...o }))),
    recommendation: parsed.data.recommendation
      ? Object.freeze({ ...parsed.data.recommendation })
      : null,
  });
}

/** A stored `metadata.escalationAnswer` value → an answer, defensively. Same
 *  never-throws / `null`-not-default rule as {@link parseEscalation}. */
export function parseEscalationAnswer(
  raw: unknown
): ChannelEscalationAnswer | null {
  if (raw === null || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = row.escalationMessageId;
  const index = row.optionIndex;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return null;
  }
  const agentId = typeof row.agentId === "string" && row.agentId ? row.agentId : null;
  return Object.freeze({
    escalationMessageId: id,
    optionIndex: index,
    agentId,
  });
}

/**
 * THE HUMAN-READABLE RENDER — the `body` an escalation post carries.
 *
 * ⚠ ONE COMPOSER, AND IT IS WHY THE CARD DEGRADES INSTEAD OF VANISHING. Every
 * field appears in the body, so a reader that knows nothing about
 * {@link ESCALATION_METADATA_KEY} still sees the whole question. The MCP tree
 * cannot import this module (separate package), so
 * `packages/mcp-server/src/tools/channel-escalate-render.ts` carries a HAND COPY
 * and `escalation-body-parity.test.ts` drives the two against one table — the
 * same pairing `lib/mentions.ts` keeps with `main/agent-handles.js`.
 *
 * ⚠ IT IS NOT MARKDOWN-ESCAPED AND MUST NOT BECOME SO. The body is rendered as
 * a BODY (`message-markdown.tsx`), which is the zone INVARIANTS §10 says is
 * rendered as itself; escaping it would make an agent's own formatting show up
 * as backslashes for every reader that falls back to the prose.
 */
export function escalationBody(e: ChannelEscalationInput): string {
  const lines: string[] = [`**Escalation:** ${e.issue}`];
  if (e.context) lines.push("", e.context);
  lines.push("", "**Options**");
  e.options.forEach((option, i) => {
    lines.push(`${i + 1}. **${option.label}** — ${option.consequence}`);
  });
  if (e.recommendation) {
    const pick = e.options[e.recommendation.index];
    lines.push(
      "",
      `**Recommended:** ${e.recommendation.index + 1}. ${pick.label} — ${e.recommendation.why}`
    );
  }
  return lines.join("\n");
}
