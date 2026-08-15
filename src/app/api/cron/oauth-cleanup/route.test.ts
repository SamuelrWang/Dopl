/**
 * `GET /api/cron/oauth-cleanup` — the orphan-client reaper. Pins: only token-less, old clients are
 * reaped; the reserved first-party device client is excluded from the scan; clients with any token
 * survive; the pre-existing code/token/rate-limit purges still run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { DEVICE_CLIENT_ID } from "@/shared/auth/mcp-credential";

vi.mock("@/shared/auth/require-cron-secret", () => ({
  requireCronSecret: vi.fn(() => null),
}));
vi.mock("@/features/analytics/server/system-events", () => ({
  logSystemEvent: vi.fn(),
}));

const db = vi.hoisted(() => ({
  /** Responses keyed `${table}:${select|delete}`; FIFO so the two mcp_tokens deletes
   *  (expired, then revoked) return distinct data. */
  responses: {} as Record<string, { data: unknown[] }[]>,
  /** Every method call in order, for asserting the SQL issued. */
  ops: [] as { table: string; method: string; args: unknown[] }[],
}));

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const st = { table, isDelete: false };
      const record = (method: string) => (...args: unknown[]) => {
        if (method === "delete") st.isDelete = true;
        db.ops.push({ table, method, args });
        return builder;
      };
      const builder: Record<string, unknown> = {};
      for (const m of ["delete", "select", "lt", "neq", "in", "limit", "eq", "is"]) {
        builder[m] = record(m);
      }
      (builder as { then: unknown }).then = (
        onF: (v: { data: unknown[] }) => unknown,
        onR?: (e: unknown) => unknown
      ) => {
        const key = `${st.table}:${st.isDelete ? "delete" : "select"}`;
        const queue = db.responses[key] ?? [];
        const next = queue.shift() ?? { data: [] };
        return Promise.resolve(next).then(onF, onR);
      };
      return builder;
    },
  }),
}));

import { GET } from "./route";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";

const request = () => new NextRequest("https://dopl.test/api/cron/oauth-cleanup");

/** Seed the four pre-existing purges so their counts are nonzero. */
function seedBasePurges() {
  db.responses["oauth_authorization_codes:delete"] = [{ data: [{ code_hash: "c" }] }];
  db.responses["mcp_tokens:delete"] = [{ data: [{ id: "t1" }] }, { data: [{ id: "t2" }] }];
  db.responses["rate_limit_events:delete"] = [{ data: [{ id: "r1" }] }];
}

function op(table: string, method: string) {
  return db.ops.filter((o) => o.table === table && o.method === method);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCronSecret).mockReturnValue(null);
  db.responses = {};
  db.ops = [];
  seedBasePurges();
});

describe("orphan-client reaping", () => {
  it("reaps the token-less client and keeps the one that has a token", async () => {
    db.responses["oauth_clients:select"] = [
      { data: [{ client_id: "c-orphan" }, { client_id: "c-keep" }] },
    ];
    db.responses["mcp_tokens:select"] = [{ data: [{ client_id: "c-keep" }] }];
    db.responses["oauth_clients:delete"] = [{ data: [{ client_id: "c-orphan" }] }];

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted.orphan_clients).toBe(1);
    expect(op("oauth_clients", "delete")[0]).toBeTruthy();
    expect(op("oauth_clients", "in")).toContainEqual({
      table: "oauth_clients",
      method: "in",
      args: ["client_id", ["c-orphan"]],
    });
    expect(body.deleted).toMatchObject({
      codes: 1,
      expired_tokens: 1,
      revoked_tokens: 1,
      rate_limit_events: 1,
    });
  });

  it("excludes the reserved device client and scopes the scan by age + limit", async () => {
    db.responses["oauth_clients:select"] = [{ data: [] }];
    await GET(request());

    const selects = op("oauth_clients", "neq");
    expect(selects).toContainEqual({
      table: "oauth_clients",
      method: "neq",
      args: ["client_id", DEVICE_CLIENT_ID],
    });
    expect(op("oauth_clients", "lt")[0].args[0]).toBe("created_at");
    expect(op("oauth_clients", "limit")[0].args[0]).toBe(500);
  });

  it("no candidates → skips the token check and the delete entirely", async () => {
    db.responses["oauth_clients:select"] = [{ data: [] }];
    const res = await GET(request());
    expect((await res.json()).deleted.orphan_clients).toBe(0);
    expect(op("mcp_tokens", "in")).toHaveLength(0);
    expect(op("oauth_clients", "delete")).toHaveLength(0);
  });

  it("all candidates have tokens → nothing is reaped", async () => {
    db.responses["oauth_clients:select"] = [
      { data: [{ client_id: "c1" }, { client_id: "c2" }] },
    ];
    db.responses["mcp_tokens:select"] = [{ data: [{ client_id: "c1" }, { client_id: "c2" }] }];
    const res = await GET(request());
    expect((await res.json()).deleted.orphan_clients).toBe(0);
    expect(op("oauth_clients", "delete")).toHaveLength(0);
  });
});

describe("auth gate", () => {
  it("fails closed before any DB work when the cron secret gate denies", async () => {
    vi.mocked(requireCronSecret).mockReturnValue(
      new Response(null, { status: 401 }) as never
    );
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(db.ops).toHaveLength(0);
  });
});
