/**
 * The recording query builder both `resolve-resource` suites drive, and the ids
 * they share.
 *
 * ⚠ **EXTRACTED WHEN THE GRANT LANE ARRIVED (2026-09-03)** — two suites over one
 * module, and a second hand-written builder is the F-278 shape: the copy is the
 * one that stops applying a filter, and this builder is the only thing in the
 * tree that ever asserts what reaches PostgREST.
 */

import { vi } from "vitest";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ResourceCaller } from "./resolve-resource";

export const ME = "22222222-3333-4444-5555-666666666666";
export const WS_A = "11111111-2222-3333-4444-555555555555";
export const WS_B = "99999999-8888-7777-6666-555555555555";
/** The caller's own `kind='personal'` container. */
export const WS_P = "77777777-7777-7777-7777-777777777777";
export const T1 = "44444444-4444-4444-4444-444444444444";

export type Call = { table: string; op: string; args: unknown[] };

/**
 * A recording query builder. `results` is keyed by table, so each read answers
 * independently and every filter it applied is inspectable afterwards.
 *
 * ⚠ **ONE BUILDER PER `.from()`, EXACTLY AS POSTGREST GIVES YOU** — a single
 * shared builder with a mutable `table` answered the MEMBERSHIP query out of
 * whichever table was named LAST, which the personal-container probe (issued
 * between building that query and awaiting it) is the first caller to notice.
 */
export function makeAdmin(
  results: Record<string, unknown[]>,
  /**
   * ⚠ **RESULT SETS CONSUMED IN ORDER, PER TABLE — AND THE GRANT LANE IS WHY
   * THIS EXISTS.** The builder applies no filters, so a table with ONE result
   * set answers both of `findResources`' queries identically and a case meant
   * to prove the SECOND one passes on the first. A sequence makes the two
   * queries distinguishable: `[[], [row]]` is "nameable by no clause, reached
   * by a grant". ⚠ Exhausting it falls back to `results[table]`.
   */
  sequences: Record<string, unknown[][]> = {}
) {
  const calls: Call[] = [];
  const pending = new Map<string, unknown[][]>(
    Object.entries(sequences).map(([t, sets]) => [t, [...sets]])
  );
  const newBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    const rec = (op: string, args: unknown[]) => {
      calls.push({ table, op, args });
      return builder;
    };
    const rows = () => pending.get(table)?.shift() ?? results[table] ?? [];
    Object.assign(builder, {
      select: (c: string) => rec("select", [c]),
      eq: (c: string, v: unknown) => rec("eq", [c, v]),
      in: (c: string, v: unknown) => rec("in", [c, v]),
      or: (f: string) => rec("or", [f]),
      is: (c: string, v: unknown) => rec("is", [c, v]),
      ilike: (c: string, v: unknown) => rec("ilike", [c, v]),
      // The grant lane bounds its fan-out (`GRANT_REACH_LIMIT`).
      limit: (n: number) => rec("limit", [n]),
      // `findPersonalContainerId` ends its chain here — at most one row.
      maybeSingle: () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rows(), error: null }),
    });
    return builder;
  };
  vi.mocked(supabaseAdmin).mockReturnValue({
    from: (t: string) => {
      calls.push({ table: t, op: "from", args: [t] });
      return newBuilder(t);
    },
  } as never);
  return calls;
}

/** The row `findPersonalContainerId` reads, when the caller has a container. */
export function personalContainer(id = WS_P) {
  return { id };
}

/** Every filter one of the two queries applied, as `op(col=value)` strings. */
export function filters(calls: Call[], table: string): string[] {
  return calls
    .filter((c) => c.table === table && c.op !== "from" && c.op !== "select")
    .map((c) => `${c.op}(${c.args.map((a) => JSON.stringify(a)).join("=")})`);
}

export function member(workspaceId: string, role = "member") {
  return { workspace_id: workspaceId, role };
}

export function templateRow(over: Record<string, unknown> = {}) {
  return {
    id: T1,
    name: "Code Auditor",
    workspace_id: WS_B,
    created_by: ME,
    workspace: { name: "Acme", kind: "standard" },
    ...over,
  };
}


export const caller: ResourceCaller = {
  userId: ME,
  credentialSubjectUserId: ME,
};
