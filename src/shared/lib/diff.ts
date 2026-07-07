/**
 * Line-level diff for the version-history views. Classic LCS dynamic
 * program — skill/knowledge files are small (KBs, not MBs), so the
 * O(n·m) table is fine and keeps this dependency-free.
 */

export interface DiffRow {
  type: "same" | "add" | "del";
  /** Original-side line (absent on additions). */
  left?: { num: number; text: string };
  /** New-side line (absent on deletions). */
  right?: { num: number; text: string };
}

/** Guard: beyond this many lines per side, fall back to a plain swap
 *  (whole file removed + added) instead of an O(n·m) table. */
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

  // LCS length table (a[i:], b[j:]).
  const n = a.length;
  const m = b.length;
  const table: Uint32Array = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] =
        a[i] === b[j]
          ? table[at(i + 1, j + 1)] + 1
          : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }

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
