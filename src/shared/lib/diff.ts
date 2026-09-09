/** Line-level diff for version-history views. Classic LCS DP — files are KBs,
 *  so the O(n·m) table is fine and keeps this dependency-free.
 *
 *  ⚠ **THE TABLE IS EXPORTED SINCE 2026-09-09**, when the CHANGELOG lane needed
 *  the SAME algorithm at WORD granularity (`features/revisions/lib/diff.ts`).
 *  Two LCS implementations in one repo is a drift pair waiting to happen; the
 *  granularity is the caller's (how the string is split), the algorithm is
 *  here. */

export interface DiffRow {
  type: "same" | "add" | "del";
  /** Original-side line (absent on additions). */
  left?: { num: number; text: string };
  /** New-side line (absent on deletions). */
  right?: { num: number; text: string };
}

/** ⚠ Beyond this many lines per side, fall back to a plain swap (whole file
 *  removed + added) instead of an O(n·m) table. */
const MAX_LINES = 5_000;

export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text, i) => ({ type: "del" as const, left: { num: i + 1, text } })),
      ...b.map((text, i) => ({ type: "add" as const, right: { num: i + 1, text } })),
    ];
  }

  const n = a.length;
  const m = b.length;
  const table = lcsTable(a, b);
  const at = (i: number, j: number) => i * (m + 1) + j;

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({
        type: "same",
        left: { num: i + 1, text: a[i] },
        right: { num: j + 1, text: b[j] },
      });
      i++;
      j++;
    } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
      rows.push({ type: "del", left: { num: i + 1, text: a[i] } });
      i++;
    } else {
      rows.push({ type: "add", right: { num: j + 1, text: b[j] } });
      j++;
    }
  }
  for (; i < n; i++) rows.push({ type: "del", left: { num: i + 1, text: a[i] } });
  for (; j < m; j++) rows.push({ type: "add", right: { num: j + 1, text: b[j] } });
  return rows;
}

/**
 * Classic LCS length table over two token arrays, `(a.length+1) × (b.length+1)`,
 * ROW-MAJOR — index it as `table[i * (b.length + 1) + j]`.
 *
 * ⚠ **THE ONE LCS IN THIS REPO.** {@link diffLines} splits on newlines;
 * `features/revisions/lib/diff.ts › diffBodies` splits on words. Neither owns
 * the algorithm, and a third granularity adds a splitter rather than a second
 * dynamic program.
 *
 * ⚠ O(n·m) IN TIME AND MEMORY. Every caller bounds its input BEFORE calling —
 * see {@link diffLines}'s line ceiling and `diffBodies`'s token ceiling.
 */
export function lcsTable(a: readonly string[], b: readonly string[]): Uint32Array {
  const w = b.length + 1;
  const table = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * w + j] =
        a[i] === b[j]
          ? table[(i + 1) * w + (j + 1)] + 1
          : Math.max(table[(i + 1) * w + j], table[i * w + (j + 1)]);
    }
  }
  return table;
}
