/**
 * TEST FIXTURE (excluded from the build): the four-halved ratchet every budget suite asserts
 * (`tool-budget.test.ts`).
 */

import { expect } from "vitest";

/**
 * ⚠ A CEILING THAT ONLY EVER MOVES DOWN — AND ALL FOUR OF ITS HALVES. Only the
 * first is a budget; the other three are what keep it one.
 *
 *   • OVER    — it grew past its ceiling. The regression this file is for.
 *   • STALE   — it shrank below its ceiling, so the ceiling can be lowered.
 *     ⚠ The description half of this **asserted nothing until 2026-09-02**: it
 *     read `len <= Math.min(ceiling, DESCRIPTION_MAX_CHARS)`, and since every
 *     ceiling here is ABOVE the cap the `Math.min` collapsed to the cap, which
 *     re-asks the OVER question. Every shrink in between — the whole range the
 *     half exists to police — passed silently. It caught two real shrinks the
 *     hour it was repaired.
 *   • DEAD    — a ceiling for a name nothing serves any more. Wave A deletes
 *     five tools; without this their entries outlive them and become headroom
 *     for whatever is added next.
 *   • MISSING — a name served with no ceiling declared. Without it a NEW tool
 *     joins the surface unbudgeted, which is how a per-item gate stops bounding
 *     the total. `cap` opts a family out of this half: descriptions have a
 *     shared cap, so only the over-cap ones declare a ceiling of their own.
 */
export interface RatchetReport {
  over: string[];
  stale: string[];
  dead: string[];
  missing: string[];
}

export function ratchet(
  measured: ReadonlyMap<string, number>,
  ceilings: Readonly<Record<string, number | undefined>>,
  cap?: number,
): RatchetReport {
  const report: RatchetReport = { over: [], stale: [], dead: [], missing: [] };
  for (const [name, size] of measured) {
    const ceiling = ceilings[name] ?? cap;
    if (ceiling === undefined) {
      report.missing.push(`${name}: ${size} chars, no ceiling declared`);
    } else if (size > ceiling) {
      report.over.push(`${name}: ${size} chars (ceiling ${ceiling})`);
    }
  }
  for (const [name, ceiling] of Object.entries(ceilings)) {
    if (ceiling === undefined) continue;
    const size = measured.get(name);
    if (size === undefined) {
      report.dead.push(`${name}: ceiling ${ceiling}, nothing serves it`);
    } else if (size < ceiling) {
      report.stale.push(`${name}: ${size} chars, ceiling ${ceiling}`);
    }
  }
  return report;
}

/** Asserts all four halves, so no ratchet can ship with three. */
export function expectRatchet(
  what: string,
  report: RatchetReport,
  grew: string,
  shrank = "lower the ceiling to the measured size in the same commit — that is how the win gets banked",
): void {
  const list = (rows: string[]) => `\n- ${rows.join("\n- ")}`;
  expect(report.over, `${what} grew past its ceiling. ${grew}:${list(report.over)}`).toEqual([]);
  expect(report.stale, `${what} shrank below its ceiling — ${shrank}:${list(report.stale)}`).toEqual([]);
  expect(report.dead, `${what}: a ceiling holding up nothing — delete the entry:${list(report.dead)}`).toEqual([]);
  expect(report.missing, `${what}: served with no ceiling — measure it and declare one, never leave it unbudgeted:${list(report.missing)}`).toEqual([]);
}
