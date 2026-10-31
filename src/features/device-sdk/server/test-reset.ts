import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * TEST-ENV RESET for CI (A6) — `POST /api/v1/test/reset`.
 *
 * ⚠ CONTRACT GAP: this route is NOT in `docs/specs/device-sdk/openapi.yaml` (frozen v1) and NOT in
 * `@dopl/sdk`. It exists so a CI run can start from an empty test env; whether it joins the contract
 * (name, response shape, scope) is Samuel's ruling. Until then it is undocumented and unsupported.
 *
 * 🔒 SCOPE: one project, the `test` env, always. The env is a LITERAL here — the store takes a
 * project id and nothing else — so no caller can point it at `live`. The route refuses `sk_live_`
 * and `pk_` keys before it gets here.
 *
 * Deletes children first, so a failure part-way leaves no row pointing at a deleted parent:
 * actions → connections → connect sessions → webhook outbox → events → devices → end users.
 * Context profiles (project configuration, not test data) and API keys are kept. The reset call's
 * own `dev_events` row is written after the delete, so one row survives.
 */

export const TEST_RESET_TABLES = [
  "dev_actions",
  "connections",
  "connect_sessions",
  "dev_webhook_outbox",
  "dev_events",
  "devices",
  "dev_end_users",
] as const;
type TestResetTable = (typeof TEST_RESET_TABLES)[number];
type TestResetCounts = Record<TestResetTable, number>;

interface TestResetStore {
  /** Delete every test-env row of `projectId` in {@link TEST_RESET_TABLES}; rows deleted per table. */
  resetTestEnv(projectId: string): Promise<TestResetCounts>;
}

export type DeleteResult = { count: number | null; error: { message: string } | null };
export type DeleteQuery = PromiseLike<DeleteResult> & {
  eq(column: string, value: string): DeleteQuery;
};
export interface ResetDb {
  from(table: string): { delete(opts: { count: "exact" }): DeleteQuery };
}

export function createSupabaseTestResetStore(db: () => ResetDb): TestResetStore {
  return {
    async resetTestEnv(projectId) {
      const counts = {} as TestResetCounts;
      for (const table of TEST_RESET_TABLES) {
        const { count, error } = await db().from(table).delete({ count: "exact" }).eq("project_id", projectId).eq("env", "test");
        if (error) throw new Error(`test reset: ${table}: ${error.message}`);
        counts[table] = count ?? 0;
      }
      return counts;
    },
  };
}

const productionStore = createSupabaseTestResetStore(() => supabaseAdmin() as unknown as ResetDb);
let store: TestResetStore = productionStore;

export const testResetStore = (): TestResetStore => store;

/** Test seam: swap the store (`null` restores production). */
export function setTestResetStoreForTests(next: TestResetStore | null): void {
  store = next ?? productionStore;
}
