/**
 * `/api/user/workspace-access-request` — the gated "+ new workspace" popup's button.
 *   1. Scoped to the AUTHENTICATED user, never a body field.
 *   2. POST is idempotent: upsert with ignoreDuplicates on user_id.
 *   3. GET answers whether this user already asked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  sessionUser: null as { id: string } | null,
  row: null as { created_at: string } | null,
  upserts: [] as Array<{ payload: unknown; opts: unknown }>,
  eqs: [] as Array<[string, unknown]>,
}));

vi.mock("@/shared/auth/mcp-session", () => ({ touchMcpStatus: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
vi.mock("@/shared/auth/mcp-oauth", () => ({
  validateAccessToken: vi.fn(async () => null),
  isOAuthAccessToken: (token: string) => token.startsWith("dopl_at_"),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: state.sessionUser ? { claims: { sub: state.sessionUser.id } } : null,
      }),
    },
  }),
}));
vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (col: string, val: unknown) => {
      state.eqs.push([col, val]);
      return chain;
    };
    chain.maybeSingle = async () => ({ data: state.row, error: null });
    chain.upsert = async (payload: unknown, opts: unknown) => {
      state.upserts.push({ payload, opts });
      return { error: null };
    };
    return { from: () => chain };
  },
}));

import { GET, POST } from "./route";

const URL_ = "http://localhost/api/user/workspace-access-request";
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  state.sessionUser = { id: "user-1" };
  state.row = null;
  state.upserts = [];
  state.eqs = [];
});

describe("workspace access request", () => {
  it("GET reports not requested for a user with no row", async () => {
    const res = await GET(new NextRequest(URL_), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: false });
    expect(state.eqs).toContainEqual(["user_id", "user-1"]);
  });

  it("GET reports requested when the row exists", async () => {
    state.row = { created_at: "2026-10-15T00:00:00Z" };
    const res = await GET(new NextRequest(URL_), ctx);
    expect(await res.json()).toEqual({ requested: true });
  });

  it("POST records the AUTHENTICATED user, idempotently", async () => {
    state.sessionUser = { id: "user-42" };
    const res = await POST(
      new NextRequest(URL_, { method: "POST", body: JSON.stringify({ user_id: "someone-else" }) }),
      ctx
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: true });
    expect(state.upserts).toEqual([
      { payload: { user_id: "user-42" }, opts: { onConflict: "user_id", ignoreDuplicates: true } },
    ]);
  });

  it("401s an unauthenticated caller without writing", async () => {
    state.sessionUser = null;
    const res = await POST(new NextRequest(URL_, { method: "POST" }), ctx);
    expect(res.status).toBe(401);
    expect(state.upserts).toEqual([]);
  });
});
