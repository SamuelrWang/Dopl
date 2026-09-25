/** The recording query builder and shared ids for the `resolve-resource` suites — one builder, so no
 *  suite's copy silently stops applying a filter (F-278). */

import { vi } from "vitest";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ResourceCaller } from "./resolve-resource";

export const ME = "22222222-3333-4444-5555-666666666666";
export const WS_A = "11111111-2222-3333-4444-555555555555";
export const WS_B = "99999999-8888-7777-6666-555555555555";
/** The caller's own `kind='home'` container. */
export const WS_P = "77777777-7777-7777-7777-777777777777";
export const T1 = "44444444-4444-4444-4444-444444444444";

export type Call = { table: string; op: string; args: unknown[] };

/** `results` is keyed by table, so each read answers independently and every filter is inspectable.
 *  One builder per `.from()`, as PostgREST gives: a built, unawaited query keeps its own table. */
export function makeAdmin(
  results: Record<string, unknown[]>,
  /** Per-table result sets consumed in order, so the grant lane's second query is distinguishable:
   *  `[[], [row]]` = nameable by no clause, reached by a grant. Exhausted → `results[table]`. */
  sequences: Record<string, unknown[][]> = {},
  /** Per-table `head:true` count; absent is `null`, not zero. */
  counts: Record<string, number | null> = {}
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
      // `findHomeSpaceId` ends its chain here — at most one row.
      maybeSingle: () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (
        resolve: (r: {
          data: unknown[];
          count: number | null;
          error: null;
        }) => void
      ) => resolve({ data: rows(), count: counts[table] ?? null, error: null }),
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

/** The row `findHomeSpaceId` reads, when the caller has a container. */
export function homeSpace(id = WS_P) {
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

export function identityRow(over: Record<string, unknown> = {}) {
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
