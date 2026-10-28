/**
 * `POST /v1/test/reset` (A6, contract gap pending Samuel's ruling): secret TEST keys only, and it
 * deletes the CALLING project's TEST-env rows and nothing else — another project's rows and the
 * caller's own live rows survive. The Supabase store runs against a fake whose delete honours
 * its `eq` filters, so the scoping is exercised, not assumed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("@/features/device-sdk/server/fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});

import { ErrorResponseSchema } from "@dopl/device-contracts";
import { fakeStore, resetFakeStore } from "@/features/device-sdk/server/fake-dev-db";
import { setDevEventSinkForTests } from "@/features/device-sdk/server/events";
import { mintApiKey } from "@/features/device-sdk/server/keys";
import {
  TEST_RESET_TABLES,
  createSupabaseTestResetStore,
  setTestResetStoreForTests,
  type DeleteQuery,
  type DeleteResult,
  type ResetDb,
} from "@/features/device-sdk/server/test-reset";
import { POST } from "./route";

type Row = { project_id: string; env: string; id: string };
let tables: Record<string, Row[]>;
let deletes: Array<{ table: string; filters: Array<[string, string]> }>;

/** A delete query whose result `exec` computes from the collected `eq` filters. */
function deleteQuery(exec: (filters: Array<[string, string]>) => DeleteResult): DeleteQuery {
  const filters: Array<[string, string]> = [];
  const q: DeleteQuery = {
    eq(column, value) {
      filters.push([column, value]);
      return q;
    },
    then(ok, err) {
      return Promise.resolve()
        .then(() => exec(filters))
        .then(ok, err);
    },
  };
  return q;
}

/** Deletes rows matching every `eq` and records the call; one table at a time, like PostgREST. */
const fakeResetDb: ResetDb = {
  from: (table) => ({
    delete: () =>
      deleteQuery((filters) => {
        deletes.push({ table, filters: [...filters] });
        const all = tables[table] ?? [];
        const hit = (r: Row) => filters.every(([c, v]) => (r as Record<string, string>)[c] === v);
        tables[table] = all.filter((r) => !hit(r));
        return { count: all.length - tables[table].length, error: null };
      }),
  }),
};

const P1 = "proj-1";
const P2 = "proj-2";
const call = (key: string | null) =>
  POST(new NextRequest("http://localhost/api/v1/test/reset", { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {} }), {
    params: Promise.resolve({}),
  });

beforeEach(() => {
  setDevEventSinkForTests({ write: async () => undefined });
  resetFakeStore();
  fakeStore.projects.set(P1, { id: P1, org_id: "o", api_version: "2026-10-27" });
  fakeStore.projects.set(P2, { id: P2, org_id: "o", api_version: "2026-10-27" });
  deletes = [];
  tables = {};
  for (const t of TEST_RESET_TABLES) {
    tables[t] = [];
    for (const project_id of [P1, P2]) for (const env of ["test", "live"]) tables[t].push({ project_id, env, id: `${t}-${project_id}-${env}` });
  }
  setTestResetStoreForTests(createSupabaseTestResetStore(() => fakeResetDb));
});

describe("POST /v1/test/reset", () => {
  it("sk_test_: deletes exactly the caller's test-env rows, children first, and reports counts", async () => {
    const { secret } = await mintApiKey({ projectId: P1, env: "test", kind: "secret" });
    const res = await call(secret);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, project_id: P1, env: "test" });
    expect(body.deleted).toEqual(Object.fromEntries(TEST_RESET_TABLES.map((t) => [t, 1])));
    expect(deletes.map((d) => d.table)).toEqual([...TEST_RESET_TABLES]);
    for (const d of deletes) expect(d.filters).toEqual([["project_id", P1], ["env", "test"]]);
    for (const t of TEST_RESET_TABLES) {
      expect(tables[t].map((r) => `${r.project_id}/${r.env}`).sort()).toEqual([`${P1}/live`, `${P2}/live`, `${P2}/test`]);
    }
  });

  it("refuses sk_live_ (403) and touches nothing", async () => {
    const { secret } = await mintApiKey({ projectId: P1, env: "live", kind: "secret" });
    const res = await call(secret);
    expect(res.status).toBe(403);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("insufficient_scope");
    expect(deletes).toEqual([]);
  });

  it("refuses pk_ (403), a key without the scopes (403) and no key (401)", async () => {
    const pk = (await mintApiKey({ projectId: P1, env: "test", kind: "publishable" })).secret;
    const narrow = (await mintApiKey({ projectId: P1, env: "test", kind: "secret", scopes: ["devices:read"] })).secret;
    expect((await call(pk)).status).toBe(403);
    expect((await call(narrow)).status).toBe(403);
    expect((await call(null)).status).toBe(401);
    expect(deletes).toEqual([]);
  });

  it("a delete error is a thrown 500, never a partial success body", async () => {
    setTestResetStoreForTests(
      createSupabaseTestResetStore(() => ({ from: () => ({ delete: () => deleteQuery(() => ({ count: null, error: { message: "boom" } })) }) }))
    );
    const { secret } = await mintApiKey({ projectId: P1, env: "test", kind: "secret" });
    await expect(call(secret)).rejects.toThrow(/test reset: dev_actions: boom/);
  });
});
