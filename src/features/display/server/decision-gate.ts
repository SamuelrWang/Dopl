import "server-only";

/**
 * **THE DECISION GATE** (2026-10-08, KB "Decision Card Adoption Audit"). An agent's plain post that
 * asks a PERSON to choose between enumerated options is refused before it is written, and the
 * refusal carries a draft of the decision card so the agent resends it in one call. Prose-only
 * framing never made agents use the card; this is a rule on the data, not on prompt compliance.
 *
 * ⚠ HIGH CONFIDENCE ONLY. A wrong refusal costs a turn; a miss costs a wall of text. So the shape
 * must be structural: 2-6 enumerated option lines, ADJACENT to a question line that asks for a
 * choice. Code, quotes, lists far from the question, one option, or a list with no question all
 * pass. A miss is a false negative the `structured_without_display` metric still counts.
 *
 * ⚠ WHO IS GATED is the caller's decision (`service-writes.ts`): agent author, kind message, at
 * least one PERSON addressed. Agent-to-agent posts, records, displays and people never reach here.
 */

export interface DecisionDraftOption {
  label: string;
  consequence: string;
}

export interface DecisionDraft {
  summary: string;
  options: DecisionDraftOption[];
}

// The decision card's own bounds (`dopl_request_decision`): 2-6 options, label <=80,
// consequence <=200, summary <=200. A draft outside them could not be resent as-is.
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const LABEL_MAX = 80;
const CONSEQUENCE_MAX = 200;
const SUMMARY_MAX = 200;
// How far (in lines) the question may sit from the option block and still be ITS question.
const QUESTION_REACH = 2;

const OPTION_LINE = /^\s*(?:\d{1,2}[.)]|[A-Fa-f][.)]|\([A-Fa-f1-9]\)|Option\s+[A-F1-9]\b[:.)]?)\s+(\S.*)$/;
// A sentence that ends in a question mark (a URL's `?q=` is not one).
const QUESTION = /\?(?:\s|["')\]]|$)/;
// The question must be about CHOOSING. English words, so other languages are a miss, never a
// wrong refusal.
const CHOICE_WORDS =
  /\b(?:which|pick|choose|choice|prefer|option|options|should (?:I|we)|shall (?:I|we)|want(?: me)? to|go with|ok(?:ay)? (?:to|with)|approve|decide|decision|your call)\b/i;
// ⚠ NOT a bare "or": "Any questions or concerns?" under a list of steps is not a choice.
// Where a label ends and its consequence begins: " — ", " - ", ": ".
const SPLIT = /\s+[—–-]\s+|:\s+/;

/** The body minus fenced code, inline code and `>` quotes, keeping line positions. */
function proseLines(body: string): string[] {
  return body
    .replace(/```[\s\S]*?(?:```|$)/g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/`[^`\n]*`/g, "")
    .split("\n")
    .map((line) => (/^\s*>/.test(line) ? "" : line));
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function isChoiceQuestion(line: string): boolean {
  const text = line.replace(/https?:\/\/\S+/g, "");
  return QUESTION.test(text) && CHOICE_WORDS.test(text);
}

function optionOf(text: string): DecisionDraftOption {
  const clean = text.replace(/\*\*/g, "").trim();
  const parts = clean.split(SPLIT);
  if (parts.length > 1 && parts[0].trim().length <= LABEL_MAX) {
    const consequence = clean.slice(parts[0].length).replace(/^\s*(?:[—–-]|:)\s*/, "");
    return { label: clip(parts[0], LABEL_MAX), consequence: clip(consequence || parts[0], CONSEQUENCE_MAX) };
  }
  return { label: clip(clean, LABEL_MAX), consequence: clip(clean, CONSEQUENCE_MAX) };
}

/**
 * The decision card this body is, or `null` when it is not confidently one. Pure.
 * One contiguous run of option lines (blank lines inside it allowed) with a choice question
 * within {@link QUESTION_REACH} lines above or below it.
 */
export function decisionDraft(body: string): DecisionDraft | null {
  if (typeof body !== "string" || body.length < 20) return null;
  const lines = proseLines(body);
  // Contiguous option blocks: [first, last, texts].
  const blocks: Array<{ first: number; last: number; texts: string[] }> = [];
  let current: { first: number; last: number; texts: string[] } | null = null;
  lines.forEach((line, i) => {
    const m = OPTION_LINE.exec(line);
    if (m) {
      if (!current) current = { first: i, last: i, texts: [] };
      current.last = i;
      current.texts.push(m[1]);
    } else if (current && line.trim() !== "") {
      blocks.push(current);
      current = null;
    }
  });
  if (current) blocks.push(current);

  for (const block of blocks) {
    if (block.texts.length < MIN_OPTIONS || block.texts.length > MAX_OPTIONS) continue;
    const near: number[] = [];
    for (let d = 1; d <= QUESTION_REACH; d += 1) near.push(block.first - d, block.last + d);
    const qIndex = near.find((i) => i >= 0 && i < lines.length && isChoiceQuestion(lines[i]));
    // A choice question INSIDE an option line ("1. Ship now, or wait?") also counts.
    const inside = qIndex === undefined && block.texts.some((t) => isChoiceQuestion(t));
    if (qIndex === undefined && !inside) continue;
    const summary = qIndex !== undefined ? lines[qIndex] : lines.slice(0, block.first).reverse().find((l) => l.trim()) || "";
    return {
      summary: clip(summary.replace(/^\s*[#*>-]+\s*/, "").replace(/\*\*/g, "") || "Which option?", SUMMARY_MAX),
      options: block.texts.map(optionOf),
    };
  }
  return null;
}

export interface DecisionGateSubject {
  body: string;
  channelId: string;
  sessionId: string | null;
}

/**
 * The draft to refuse with (and the metric line that counts it), or `null` to let the post through.
 * The caller has already decided this post is an agent's plain message to a person.
 */
export function decisionGate(s: DecisionGateSubject): DecisionDraft | null {
  const draft = decisionDraft(s.body);
  if (!draft) return null;
  console.info(
    "[display-nudge] " +
      JSON.stringify({
        evt: "structured_without_display",
        hint: "choice",
        signals: ["decision_draft"],
        refused: true,
        options: draft.options.length,
        channel_id: s.channelId,
        session_id: s.sessionId,
        chars: s.body.length,
      })
  );
  return draft;
}
