import type { ChoiceBlock, DisplayBlock, DisplayLayout, Positioned } from "./types";

/**
 * **ONE DISPLAY → A LENS** (spec §2.5). v2 blocks become the G2 primitive vocabulary
 * (`glasses/core/screens/spec.ts`: text / list / progress / divider / spacer), which the platform
 * compiler lays out. Deterministic degradation ladder, tried from level 0 until the compiler fits:
 *   1 drops the choice's description/recommendation notes · 2 spacers · 3 dividers ·
 *   4+ halves table / fields / list rows again at each level (`+N more`), down to 1 each.
 * Client-safe and platform-free: byte budgets arrive as options.
 */

/** A primitive block as the platform compiler takes it (its own normalizer re-checks every field). */
type LensPrimitive = Record<string, unknown> & { id: string; type: "text" | "list" | "progress" | "divider" | "spacer" };

export interface LensOptions {
  block_id: string;
  items: string[];
  /** Index of the recommended option, or null. */
  recommended: number | null;
}

export interface LensPrimitives {
  blocks: LensPrimitive[];
  /** Chat mode only: the choice, laid out by the plugin as the page's footer list. */
  options: LensOptions | null;
}

export interface DegradeOpts {
  mode: "screen" | "chat";
  level: number;
  /** A list item's byte budget on this lens (G2: 63). */
  itemBytes: number;
}

/** Levels past 4 keep halving; 9 halvings take any neutral block (≤20 rows) to one row. */
const MAX_DEGRADE_LEVEL = 9;
const LEVEL_NAMES = ["", "choice notes", "spacers", "dividers"];
export const degradeLabel = (level: number) => (level >= 4 ? "rows halved" : LEVEL_NAMES[level]);

/** The lens marker on the recommended option — display text, never part of an answer. */
export const REC_MARK = " (rec)";
const ENCODER = new TextEncoder();
const utf8 = (s: string) => ENCODER.encode(s).length;
function clampBytes(s: string, max: number): string {
  let out = s;
  while (utf8(out) > max) out = out.slice(0, -1);
  return out;
}

/** Keep the first `keep` rows and say how many were dropped. */
function halve<T>(rows: T[], level: number, more: (n: number) => T): T[] {
  if (level < 4 || rows.length <= 1) return rows;
  const keep = Math.max(1, Math.ceil(rows.length / 2 ** (level - 3)));
  return keep >= rows.length ? rows : [...rows.slice(0, keep), more(rows.length - keep)];
}

const geometry = (b: Positioned<DisplayBlock>) => {
  const g: Record<string, number> = {};
  for (const k of ["x", "y", "w", "h"] as const) if (b[k] !== undefined) g[k] = b[k] as number;
  return g;
};

function choiceNotes(c: ChoiceBlock): string | null {
  const lines = c.options.filter((o) => o.description).map((o) => `${o.label}: ${o.description}`);
  const rec = c.options.find((o) => o.recommended);
  if (rec) lines.push(`Recommended: ${rec.label}${rec.why ? ` - ${rec.why}` : ""}`);
  return lines.length ? lines.join("\n") : null;
}

export function toLensPrimitives(blocks: readonly Positioned<DisplayBlock>[], opts: DegradeOpts): LensPrimitives {
  const { mode, level, itemBytes } = opts;
  const out: LensPrimitive[] = [];
  let options: LensOptions | null = null;
  for (const b of blocks) {
    const geo = mode === "screen" ? geometry(b) : {};
    const text = (content: string, extra: Record<string, unknown> = {}) => out.push({ id: b.id, type: "text", content, ...extra, ...geo });
    switch (b.type) {
      case "heading":
        text(b.text, { brightness: 4 });
        break;
      case "text": {
        const brightness = b.brightness ?? (b.tone === "strong" ? 4 : b.tone === "muted" ? 2 : undefined);
        text(b.content, {
          ...(b.lines !== undefined && { lines: b.lines }),
          ...(brightness !== undefined && { brightness }),
          ...(b.border && { border: true }),
        });
        break;
      }
      case "fields":
        text(halve(b.rows.map((r) => `${r.label}: ${r.value}`), level, (n) => `+${n} more`).join("\n"));
        break;
      case "table": {
        const rows = halve(b.rows.map((r) => r.join(" · ")), level, (n) => `+${n} more`);
        text([b.columns.join(" · "), ...rows].join("\n"));
        break;
      }
      case "list": {
        const items = b.items.map((item, i) => clampBytes(b.style === "number" ? `${i + 1}. ${item}` : item, itemBytes));
        out.push({ id: b.id, type: "list", items: halve(items, level, (n) => `+${n} more`), selectable: false, ...geo });
        break;
      }
      case "choice": {
        const notes = level >= 1 ? null : choiceNotes(b);
        if (notes) out.push({ id: `n_${b.id}`.slice(0, 32), type: "text", content: notes, brightness: 2 });
        const rec = b.options.findIndex((o) => o.recommended);
        const items = b.options.map((o, i) => {
          const label = clampBytes(o.label, itemBytes);
          return i === rec && utf8(label + REC_MARK) <= itemBytes ? label + REC_MARK : label;
        });
        if (mode === "chat") options = { block_id: b.id, items, recommended: rec >= 0 ? rec : null };
        else out.push({ id: b.id, type: "list", items, selectable: true, ...geo });
        break;
      }
      case "progress":
        out.push({ id: b.id, type: "progress", value: b.value, ...(b.label && { label: b.label }), ...geo });
        break;
      case "divider":
        if (level < 3) out.push({ id: b.id, type: "divider", ...geo });
        break;
      case "spacer":
        if (level < 2) out.push({ id: b.id, type: "spacer", ...(b.lines !== undefined && { lines: b.lines }) });
        break;
    }
  }
  return { blocks: out, options };
}

export type FitResult<P, E> =
  | { ok: true; level: number; payload: P; primitives: LensPrimitives }
  | { ok: false; level: number; errors: E[] };

/**
 * Walk the ladder: the first level whose primitives the platform compiles. An `absolute` layout
 * is the agent's own geometry, so it is compiled once, undegraded. Failing everywhere returns the
 * level-0 errors (the agent's own blocks, the fixable ones) and the deepest level tried.
 */
export function fitLens<P, E>(
  blocks: readonly Positioned<DisplayBlock>[],
  layout: DisplayLayout,
  opts: Omit<DegradeOpts, "level">,
  compile: (p: LensPrimitives) => { ok: true; payload: P } | { ok: false; errors: E[] }
): FitResult<P, E> {
  const top = layout === "absolute" ? 0 : MAX_DEGRADE_LEVEL;
  let first: E[] = [];
  for (let level = 0; level <= top; level++) {
    const primitives = toLensPrimitives(blocks, { ...opts, level });
    const res = compile(primitives);
    if (res.ok) return { ok: true, level, payload: res.payload, primitives };
    if (level === 0) first = res.errors;
  }
  return { ok: false, level: top, errors: first };
}
