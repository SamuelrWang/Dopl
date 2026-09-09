/**
 * WORD-LEVEL DIFF — pure, dependency-free, and deliberately small.
 *
 * ⚠ **WHY NOT A LIBRARY.** Every diff package in reach is character-level (a
 * wall of noise on prose) or arrives with its own DOM opinions. An LCS over
 * tokens is forty lines and has no version to keep current.
 *
 * ⚠ **AND IT DOES NOT OWN THE ALGORITHM — `shared/lib/diff.ts › lcsTable` DOES**,
 * which already held the LINE-level diff for the skills version rail. Local here
 * are the SPLITTER and the rendering model.
 *
 * ⚠ **TOKENS, NOT CHARACTERS, AND THE WHITESPACE RIDES WITH THE WORD**, so
 * re-joining every token reconstructs the input EXACTLY and the renderer never
 * re-inserts spacing it guessed at. It is also what makes CJK behave — a run of
 * Han with no spaces is ONE token, so an edit inside it reports the whole run
 * changed rather than splitting a script with no word boundaries, and nothing is
 * mangled mid-grapheme the way a UTF-16 character diff mangles astral scripts.
 *
 * ⚠ **QUADRATIC, AND BOUNDED FOR IT.** Past {@link DIFF_TOKEN_CEILING} tokens per
 * side the `O(n·m)` table is skipped and the bodies are reported as one whole-body
 * replace: "this document was rewritten" is honest, a renderer that hangs on a
 * 200 KB entry is not. Stated here, not at the call site, so both surfaces
 * inherit it.
 */

import { lcsTable } from "@/shared/lib/diff";

/** Per side. ⚠ ~1,600 tokens is a long entry; the table at the ceiling is 2.5M
 *  cells of `Uint32Array`, which is 10 MB and a few milliseconds. */
export const DIFF_TOKEN_CEILING = 1_600;

export type DiffKind = "same" | "added" | "removed";

export interface DiffSpan {
  kind: DiffKind;
  /** Verbatim source text, whitespace included. Concatenating every span whose
   *  kind is not `added` reproduces `before`; not `removed` reproduces `after`. */
  text: string;
}

/** Split into tokens: one run of non-whitespace plus its trailing whitespace.
 *  ⚠ Leading whitespace is its own token, so `tokenize(s).join("") === s` for
 *  every string — the property the module rests on, checked first in
 *  `./diff.test.ts`. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  // `\S+\s*` catches every word-with-trailer; a leading run of whitespace is
  // matched by the second arm and kept as a token of its own.
  for (const m of text.matchAll(/\S+\s*|\s+/g)) out.push(m[0]);
  return out;
}

/**
 * Word-level spans between two bodies, in `after` order with removals spliced in
 * at the point they were removed from.
 *
 * ⚠ IDENTICAL BODIES ANSWER ONE `same` SPAN, not an empty array — "nothing
 * changed" and "there is nothing here" are different facts and a renderer must
 * be able to tell them apart. Two EMPTY bodies answer an empty array, because
 * there genuinely is nothing.
 */
export function diffBodies(before: string, after: string): DiffSpan[] {
  if (before === after) {
    return before === "" ? [] : [{ kind: "same", text: before }];
  }
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length === 0) return [{ kind: "added", text: after }];
  if (b.length === 0) return [{ kind: "removed", text: before }];
  if (a.length > DIFF_TOKEN_CEILING || b.length > DIFF_TOKEN_CEILING) {
    // ⚠ THE CEILING'S ANSWER IS A WHOLE-BODY REPLACE, NOT A TRUNCATION. A
    // partial diff would read as a complete one.
    return [
      { kind: "removed", text: before },
      { kind: "added", text: after },
    ];
  }
  return spansOf(a, b, lcsTable(a, b));
}

/** Walk the table forwards, merging consecutive tokens of one kind into a span.
 *  ⚠ A REMOVAL IS EMITTED BEFORE THE ADDITION AT THE SAME POSITION, always, so a
 *  replaced word reads left-to-right as old-then-new. */
function spansOf(a: string[], b: string[], table: Uint32Array): DiffSpan[] {
  const w = b.length + 1;
  const out: DiffSpan[] = [];
  const push = (kind: DiffKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (table[(i + 1) * w + j] >= table[i * w + (j + 1)]) {
      push("removed", a[i]);
      i++;
    } else {
      push("added", b[j]);
      j++;
    }
  }
  while (i < a.length) push("removed", a[i++]);
  while (j < b.length) push("added", b[j++]);
  return out;
}

/** How much of a diff is CHANGE — the "+N / −M words" a changelog row shows.
 *  ⚠ Counts TOKENS, so a span of three added words counts three. */
export function diffStats(spans: readonly DiffSpan[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const span of spans) {
    if (span.kind === "added") added += tokenize(span.text).length;
    else if (span.kind === "removed") removed += tokenize(span.text).length;
  }
  return { added, removed };
}
