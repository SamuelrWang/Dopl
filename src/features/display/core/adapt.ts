import {
  ESCALATION_METADATA_KEY,
  parseStoredEscalation,
  type ChannelEscalation,
} from "@/features/channels/escalation";
import { displayFallback } from "./fallback";
import { normalizeDisplay } from "./normalize";
import {
  DISPLAY_LIMITS,
  DISPLAY_METADATA_KEY,
  choiceOf,
  type ChoiceOption,
  type Display,
  type DisplayAnswerStamp,
  type DisplayBlock,
} from "./types";

/**
 * **EVERY STORED SHAPE → ONE `Display`** (spec §5.1), at read time, no data rewrite:
 *   1. `metadata.display` v2 (re-normalized tolerantly: invalid → the next rule);
 *   2. a v1 display (`blocks`, no/1 `spec_version`) → `fromV1`;
 *   3. a decision (`metadata.escalation`, RELAXED stored parse) → {@link displayFromEscalation};
 *   4. else `null` — the body renders. A tolerant reader, never a validator.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** A stored answer stamp (v1 or v2 shape) → the v2 stamp, or null. `choiceId` fills a v1 null block id. */
export function answerStampOf(raw: unknown, choiceId: string): DisplayAnswerStamp | null {
  if (!isObj(raw) || typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0) return null;
  if (typeof raw.choice !== "string") return null;
  const stamp: DisplayAnswerStamp = {
    block_id: str(raw.block_id) ?? choiceId,
    index: raw.index,
    choice: raw.choice,
    at: str(raw.at) ?? "",
    via: str(raw.via) ?? "web",
  };
  const by = str(raw.by);
  const messageId = str(raw.message_id);
  if (by) stamp.by = by;
  if (messageId) stamp.message_id = messageId;
  return stamp;
}

/** A decision's blocks: the issue as TEXT (not a heading), so legacy cards look exactly as today. */
export function displayFromEscalation(
  e: Pick<ChannelEscalation, "issue" | "context" | "options"> & { recommendation?: ChannelEscalation["recommendation"] }
): DisplayBlock[] {
  const blocks: DisplayBlock[] = [{ id: "issue", type: "text", content: e.issue }];
  if (e.context) blocks.push({ id: "context", type: "text", content: e.context });
  blocks.push({
    id: "decision",
    type: "choice",
    options: e.options.map((o, i) => {
      const option: ChoiceOption = { label: o.label };
      if (o.consequence) option.description = o.consequence;
      if (e.recommendation?.index === i) {
        option.recommended = true;
        if (e.recommendation.why) option.why = e.recommendation.why;
      }
      return option;
    }),
  });
  return blocks;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * **THE DECISION INDEX** (spec §5.2): the `metadata.escalation` projection the server stamps
 * beside a display with a `choice`, so every existing decision mechanism (answerers, the unique
 * answer index, typed answers, agent wake, waiting items, old desktops) keeps working unchanged.
 * `null` when the display has no choice.
 */
export function decisionIndexOf(blocks: readonly DisplayBlock[]): ChannelEscalation | null {
  const choice = choiceOf(blocks);
  // A v1-born choice outside 2-12 options is not a decision (the stored index could not parse).
  if (!choice || choice.options.length < DISPLAY_LIMITS.options.min || choice.options.length > DISPLAY_LIMITS.options.max) return null;
  const rest = blocks.filter((b) => b !== choice);
  const heading = rest.find((b) => b.type === "heading");
  const firstText = rest.find((b) => b.type === "text");
  let issue = "Choose one";
  let others: DisplayBlock[] = rest;
  if (heading) {
    issue = heading.text;
    others = rest.filter((b) => b !== heading);
  } else if (firstText) {
    const [line, ...more] = firstText.content.split("\n");
    issue = line.trim() || issue;
    const remainder = more.join("\n").trim();
    others = rest.flatMap((b) => (b !== firstText ? [b] : remainder ? [{ ...firstText, content: remainder }] : []));
  }
  const rec = choice.options.findIndex((o) => o.recommended);
  return {
    issue: clip(issue, 200),
    context: others.length ? clip(displayFallback(others), 2000) : "",
    options: choice.options.map((o) => ({ label: o.label, consequence: o.description ?? "" })),
    recommendation: rec >= 0 ? { index: rec, why: choice.options[rec].why ?? "" } : null,
  };
}

export function displayOf(
  metadata: Json | null | undefined,
  /** `messageId`: the id a legacy decision (no display id of its own) is known by. */
  opts: { pageAnswer?: DisplayAnswerStamp | null; messageId?: string } = {}
): Display | null {
  const raw = metadata?.[DISPLAY_METADATA_KEY];
  const decision = isObj(metadata?.[ESCALATION_METADATA_KEY]);
  const build = (from: Display["from"], blocks: DisplayBlock[], layout: Display["layout"], env: Json): Display => {
    const choice = choiceOf(blocks);
    return {
      from,
      display_id: str(env.display_id) ?? str(env.screen_id) ?? opts.messageId ?? "",
      blocks,
      layout,
      answer: (choice && answerStampOf(env.answer, choice.id)) ?? opts.pageAnswer ?? null,
      wait_until: str(env.wait_until),
      glasses_message_id: str(env.glasses_message_id),
      decision,
    };
  };
  if (isObj(raw) && Array.isArray(raw.blocks)) {
    const version = raw.spec_version === 2 ? 2 : raw.spec_version === undefined || raw.spec_version === 1 ? 1 : null;
    const checked = version ? normalizeDisplay({ blocks: raw.blocks, layout: raw.layout }, { version, tolerant: true }) : null;
    if (checked?.ok) return build(version === 2 ? "v2" : "v1", checked.display.blocks, checked.display.layout, raw);
  }
  const escalation = decision ? parseStoredEscalation(metadata?.[ESCALATION_METADATA_KEY]) : null;
  if (escalation) return build("escalation", displayFromEscalation(escalation), "stack", {});
  return null;
}
