/**
 * Channels — **A PIPE GRID WITH NO DELIMITER ROW IS STILL A TABLE** (Samuel, 2026-09-16:
 * *"in messages from agents, a lot of times there's this symbol: | being used a lot. Is
 * that markdown for like a table? … we need to create it so that in the channel inline, it
 * can render bolded text and tables"*).
 *
 * ⚠ **THE RENDERER WAS NEVER THE MISSING PIECE.** `message-markdown.tsx` has rendered
 * `**bold**` and GFM tables since 2026-08-21 and still does; what reached the transcript as
 * raw pipes is the grid an agent writes WITHOUT the `|---|---|` row under its header.
 * Measured against `marked@18`, `gfm: true`:
 *
 *     | a | b |\n|---|---|\n| 1 | 2 |   →  table
 *     | a | b |\n| 1 | 2 |              →  paragraph   ← the whole defect
 *
 * GFM requires the delimiter row, `marked` obeys GFM, and the author's characters then
 * print as characters — correctly, and uselessly. So the fix is at the SOURCE TEXT, one
 * pass before the lexer: supply the row the author omitted and let the existing table
 * branch do the rest. **No new render path, no second parser, no HTML string** (rule 1
 * of `message-markdown.tsx` is untouched — this returns markdown, not markup).
 *
 * 🔒 **IT MUST NOT PROMOTE THE WIRE FORMAT, AND THAT IS THE HARD PART.** Agents in this
 * channel post `READER-MAIN→ORCH | EVIDENCE | three things from the read` — pipes as
 * SEPARATORS in ordinary prose, several a day. Turning one of those into a two-column
 * table would be a far worse bug than the one being fixed, so the promotion rule is
 * deliberately narrow and refuses everything it is not sure about:
 *
 *  1. **Every line in the run is FENCED BY PIPES** — it starts `|` and ends `|`. The wire
 *     format starts with a sender, so it is never a candidate; a prose line that merely
 *     contains a pipe is never a candidate either.
 *  2. **At least TWO consecutive such lines.** One `| a | b |` on its own is a sentence
 *     somebody typed, not a grid, and a one-row table says nothing a line of text does not.
 *  3. **The same cell count on every line.** A ragged run is prose that happens to be
 *     bracketed, and a table built from it would silently drop or invent cells.
 *  4. **Not already a table** — a run whose second line is a delimiter is left exactly as
 *     it is, so every table that renders today renders identically after this.
 *  5. **Never inside a fence.** ``` blocks are quoted text; rewriting an author's code
 *     sample is the one edit a transcript may never make.
 *
 * ⚠ **LENGTH IS NOT PRESERVED AND NOTHING DOWNSTREAM MAY ASSUME IT IS.** This inserts a
 * line. It runs on the TRANSCRIPT body only — never on the composer's mirror, where the
 * offset walk is exact by contract (`composer-tint.tsx`).
 */

/** A delimiter row: `|---|---|`, `| :-- | --: |`, and the alignment spellings between. */
const DELIMITER_RE = /^\|(?:\s*:?-{1,}:?\s*\|)+$/;

/** Pipes the author escaped are CONTENT, not cell walls — GFM's own rule. */
const CELL_SPLIT_RE = /(?<!\\)\|/;

/** An indented code block starts at four spaces; a table never does. */
const INDENT_RE = /^ {0,3}\S/;

/**
 * The cell count of a pipe-fenced line, or `null` where the line is not one.
 *
 * ⚠ **BOTH WALLS REQUIRED.** `a | b` is prose with a pipe in it — GFM would accept it as a
 * headerless row and so would half the agents in this room, which is exactly why this asks
 * for the stricter shape: the cost of a missed table is a line of text, the cost of a
 * promoted sentence is a lie about what the author wrote.
 */
function cellCount(line: string): number | null {
  const trimmed = line.trim();
  if (!INDENT_RE.test(line)) return null;
  if (trimmed.length < 3) return null;
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  // ⚠ THE WALLS ARE NOT CELLS. `| a | b |` splits to ["", " a ", " b ", ""].
  const cells = trimmed.split(CELL_SPLIT_RE).slice(1, -1);
  return cells.length >= 2 ? cells.length : null;
}

/** The row `marked` is waiting for, sized to the header the author did write. */
function delimiterFor(count: number, indent: string): string {
  return `${indent}|${" --- |".repeat(count)}`;
}

/**
 * Insert the missing delimiter row into every pipe grid that lacks one.
 *
 * ⚠ **A PURE STRING → STRING PASS, RUN ONCE PER BODY BEFORE `marked.lexer`.** It is not a
 * token transform and must not become one: everything after it is the renderer that
 * already exists.
 */
export function normalizePipeTables(text: string): string {
  // ⚠ THE CHEAP EXIT FIRST — most bodies hold no pipe at all, and this runs on every row
  // of every transcript render.
  if (!text.includes("|")) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let fenced = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // ⚠ ``` AND ~~~ BOTH, and the flag flips on the OPENING line too — a fence's own
    // marker is never a table row either way.
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      out.push(line);
      i += 1;
      continue;
    }
    if (fenced || cellCount(line) === null) {
      out.push(line);
      i += 1;
      continue;
    }
    // ⚠ **THE RUN IS THE UNIT OF THE DECISION, NEVER THE LINE** — and that is what stops
    // the pass from rewriting its own output shape: a delimiter row is ITSELF pipe-fenced,
    // so a line-at-a-time walk read `| --- | --- |` + the first body row as a fresh
    // headerless grid and inserted a SECOND delimiter into a table that was already valid.
    // Collecting the whole contiguous block and deciding once cannot do that.
    let end = i;
    while (end < lines.length && cellCount(lines[end]) !== null) end += 1;
    const run = lines.slice(i, end);
    out.push(...promoteRun(run));
    i = end;
  }
  return out.join("\n");
}

/**
 * One contiguous block of pipe-fenced lines, promoted or handed back verbatim.
 *
 * ⚠ **VERBATIM IS THE DEFAULT AND EVERY REFUSAL RETURNS IT** — the author's characters
 * survive every branch this cannot act on.
 */
function promoteRun(run: readonly string[]): readonly string[] {
  // Rule 2: one row is a sentence somebody typed.
  if (run.length < 2) return run;
  // Rule 4: already a table — a delimiter under the header is GFM's own signal, and this
  // pass has nothing to add to it.
  if (DELIMITER_RE.test(run[1].trim())) return run;
  // Rule 3: one width for the whole run, or it is bracketed prose.
  const count = cellCount(run[0]);
  if (count === null || run.some((line) => cellCount(line) !== count)) return run;
  const indent = run[0].slice(0, run[0].length - run[0].trimStart().length);
  return [run[0], delimiterFor(count, indent), ...run.slice(1)];
}
