/**
 * ENFORCEMENT (D3) — fit content to a device's limits WITHOUT EVER REWRITING IT. Pure.
 *
 * 🔒 D3 (Samuel, 2026-10-27): Dopl only ENFORCES limits. The three overflow behaviours are the
 * contract's `ProfileOverflowSchema`, and nothing else:
 *   - `truncate`        → keep a PREFIX (lines, then characters, then UTF-8 bytes; whole blocks).
 *                          No ellipsis, no summary, no reflow: every character delivered is the
 *                          developer's, in their order.
 *   - `{ send_to: k }`  → deliver the UNCHANGED content to the user's next device of kind `k`.
 *   - `callback`        → deliver nothing; hand the limits back so the developer's agent writes a
 *                          shorter version in its own voice.
 *
 * Limits come from the profile's `output` (`max_lines`, `max_chars`) and the chosen capability's
 * adapter descriptor (`present.display` → `max_blocks` / `max_text_bytes` / `max_lines_per_text`,
 * `present.notify` → `body_bytes` / `max_lines`, `ask.*` → `question_bytes`); the tightest wins.
 */
import type { CapabilityDescriptor, ContextProfile, DeliverContent, DeviceKind, DisplayBlock } from "../types";

export interface OutputLimits {
  max_lines?: number;
  max_chars?: number;
  /** UTF-8 bytes of the text (or of each text block). */
  max_bytes?: number;
  max_blocks?: number;
}

export interface Measured {
  lines: number;
  chars: number;
  bytes: number;
  blocks: number;
}

export type EnforceOutcome =
  | { kind: "fits"; content: DeliverContent }
  | { kind: "truncated"; content: DeliverContent; measured: Measured; limits: OutputLimits }
  | { kind: "send_to"; to: DeviceKind; measured: Measured; limits: OutputLimits }
  | { kind: "callback"; measured: Measured; limits: OutputLimits };

const ENC = new TextEncoder();
const bytesOf = (s: string) => ENC.encode(s).length;
const charsOf = (s: string) => Array.from(s).length;
const linesOf = (s: string) => (s === "" ? 0 : s.split("\n").length);

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
const min = (...xs: (number | undefined)[]): number | undefined => {
  const d = xs.filter((x): x is number => x !== undefined);
  return d.length ? Math.min(...d) : undefined;
};

/** The tightest of the profile's output limits and the descriptor's. */
export function limitsFor(profile: ContextProfile, descriptor: CapabilityDescriptor | null): OutputLimits {
  const l = descriptor?.limits ?? {};
  const out: OutputLimits = {
    max_lines: min(profile.output.max_lines, num(l.max_lines), num(l.max_lines_per_text)),
    max_chars: profile.output.max_chars,
    max_bytes: min(num(l.max_text_bytes), num(l.body_bytes), num(l.question_bytes)),
    max_blocks: num(l.max_blocks),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as OutputLimits;
}

const blockText = (b: DisplayBlock): string =>
  b.type === "text" ? b.content : b.type === "heading" ? b.text : "";

export function measure(content: DeliverContent): Measured {
  const text = content.text ?? "";
  const blockTexts = (content.blocks ?? []).map(blockText);
  return {
    lines: Math.max(linesOf(text), ...blockTexts.map(linesOf), 0),
    chars: Math.max(charsOf(text), ...blockTexts.map(charsOf), 0),
    bytes: Math.max(bytesOf(text), ...blockTexts.map(bytesOf), 0),
    blocks: content.blocks?.length ?? 0,
  };
}

export function fits(m: Measured, l: OutputLimits): boolean {
  return (
    (l.max_lines === undefined || m.lines <= l.max_lines) &&
    (l.max_chars === undefined || m.chars <= l.max_chars) &&
    (l.max_bytes === undefined || m.bytes <= l.max_bytes) &&
    (l.max_blocks === undefined || m.blocks <= l.max_blocks)
  );
}

/** The longest PREFIX of `text` within the limits. Never adds, reorders or replaces a character. */
export function truncateText(text: string, l: OutputLimits): string {
  let out = text;
  if (l.max_lines !== undefined) out = out.split("\n").slice(0, l.max_lines).join("\n");
  if (l.max_chars !== undefined) out = Array.from(out).slice(0, l.max_chars).join("");
  if (l.max_bytes !== undefined) {
    const cps = Array.from(out);
    let bytes = 0;
    let n = 0;
    for (const cp of cps) {
      const b = bytesOf(cp);
      if (bytes + b > l.max_bytes) break;
      bytes += b;
      n += 1;
    }
    out = cps.slice(0, n).join("");
  }
  return out;
}

function truncateBlock(b: DisplayBlock, l: OutputLimits): DisplayBlock {
  if (b.type === "text") return { ...b, content: truncateText(b.content, l) };
  if (b.type === "heading") return { ...b, text: truncateText(b.text, l) };
  return b;
}

export function truncateContent(content: DeliverContent, l: OutputLimits): DeliverContent {
  const out: DeliverContent = { ...content };
  if (content.text !== undefined) out.text = truncateText(content.text, l);
  if (content.blocks) {
    const kept = l.max_blocks !== undefined ? content.blocks.slice(0, l.max_blocks) : content.blocks;
    out.blocks = kept.map((b) => truncateBlock(b, l));
  }
  return out;
}

export function enforce(content: DeliverContent, profile: ContextProfile, limits: OutputLimits): EnforceOutcome {
  const measured = measure(content);
  if (fits(measured, limits)) return { kind: "fits", content };
  const o = profile.overflow;
  if (o === "callback") return { kind: "callback", measured, limits };
  if (o !== "truncate") return { kind: "send_to", to: o.send_to, measured, limits };
  return { kind: "truncated", content: truncateContent(content, limits), measured, limits };
}
