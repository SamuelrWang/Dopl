import "server-only";
import { Throttle } from "@/features/glasses/core/ttl-cache";

/**
 * **THE DISPLAY NUDGE** (spec §6.2–6.3) — soft but firm enforcement. An agent's plain send whose
 * body LOOKS structured (options with a question, a markdown table, a run of list or key-value
 * lines) carries a one-line hint back to the caller, and a log line counts it. Nothing is
 * converted and nothing refused; plain chat stays plain. `choice` is never throttled (decisions
 * MUST be displays); `structure` at most once per agent session per 30 min.
 */

export type DisplayHint = "choice" | "structure";

const MIN_CHARS = 40;
const OPTION_LINE = /^\s*(?:\d{1,2}[.)]|[A-Fa-f][.)]|\([A-Fa-f1-9]\)|Option\s+[A-F1-9]\b[:.)]?)\s+\S/;
const ASK_OR =
  /\b(?:should (?:I|we)|shall (?:I|we)|do you want(?: me)?(?: to)?|would you (?:like|prefer)|which (?:one|option|do you)|(?:ok|okay) to|approve)\b[^?\n]{0,160}\bor\b[^?\n]{0,120}\?/i;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}/;
const LIST_LINE = /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/;
const KV_LINE = /^\s*[A-Za-z][\w /()-]{0,30}:\s+\S/;

/** The body minus fenced code, inline code and `>` quotes — prose an agent QUOTED is not its own. */
function proseOf(body: string): string[] {
  return body
    .replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/`[^`\n]*`/g, "")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line));
}

function run(lines: string[], re: RegExp, n: number): boolean {
  let streak = 0;
  for (const line of lines) {
    streak = re.test(line) && line.length <= 100 ? streak + 1 : 0;
    if (streak >= n) return true;
  }
  return false;
}

/** Which signals fire, `choice` first (it wins). */
export function structuredProseSignals(body: string): { hint: DisplayHint | null; signals: string[] } {
  if (body.length < MIN_CHARS) return { hint: null, signals: [] };
  const lines = proseOf(body);
  const text = lines.join("\n");
  const signals: string[] = [];
  if (lines.filter((l) => OPTION_LINE.test(l)).length >= 2 && text.includes("?")) signals.push("options");
  if (lines.some((l) => ASK_OR.test(l))) signals.push("either_or");
  const choice = signals.length > 0;
  if (lines.some((l, i) => (l.match(/\|/g)?.length ?? 0) >= 2 && TABLE_RULE.test(lines[i + 1] ?? ""))) signals.push("table");
  if (run(lines, LIST_LINE, 3)) signals.push("list");
  if (run(lines, KV_LINE, 3)) signals.push("fields");
  return { hint: choice ? "choice" : signals.length ? "structure" : null, signals };
}

const structureThrottle = new Throttle<string>(30 * 60_000, 10_000);

export interface NudgeSubject {
  body: string;
  channelId: string;
  sessionId: string | null;
  userId: string;
}

/** The hint to hand back (and log), or null. Throttled per agent session for `structure`. */
export function displayNudge(s: NudgeSubject, now = Date.now()): DisplayHint | null {
  const { hint, signals } = structuredProseSignals(s.body);
  if (!hint) return null;
  // The METRIC counts every structured post; the throttle only mutes the tip (§6.3).
  const throttled = hint === "structure" && !structureThrottle.tryAcquire(s.sessionId ?? `user:${s.userId}`, now);
  console.info(
    "[display-nudge] " +
      JSON.stringify({ evt: "structured_without_display", hint, signals, throttled, channel_id: s.channelId, session_id: s.sessionId, chars: s.body.length })
  );
  return throttled ? null : hint;
}
