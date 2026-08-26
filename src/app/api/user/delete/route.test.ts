/**
 * `DELETE /api/user/delete` — THE SHARED-WORKSPACE GUARD, and the one kind of
 * workspace it must not see.
 *
 * A `kind='link'` home-channel container has a second active member BY
 * CONSTRUCTION — that member IS the relationship. An unfiltered guard therefore
 * 409s every account that ever claimed a home link, telling them to "transfer
 * ownership or remove the other members" of a workspace they cannot open, in a
 * UI that lists no such workspace. The guard runs through `isStandardWorkspace`
 * and nothing else.
 *
 * The REAL guard — a standard workspace with co-members still blocks — is
 * pinned beside it, because a filter is only correct if it still refuses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  /** `workspaces` rows the owner query answers with. */
  owned: [] as Array<Record<string, unknown>>,
  /** `workspace_members` rows the co-member probe answers with. */
  coMembers: [] as Array<{ workspace_id: string }>,
  /** Ids the co-member probe was actually asked about. */
  probed: null as string[] | null,
  deleted: false,
}));

vi.mock("@/shared/auth/mcp-session", () => ({ touchMcpStatus: vi.fn() }));
vi.mock("@/features/analytics/server/mcp-events", () => ({ logMcpEvent: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
vi.mock("@/shared/auth/mcp-oauth", () => ({
  isOAuthAccessToken: () => false,
  validateAccessToken: vi.fn(async () => null),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "user-1" } } }) },
  }),
}));
vi.mock("@/features/billing/server/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/features/billing/server/subscriptions", () => ({
  getProfileBillingRef: vi.fn(async () => null),
}));

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => {
    const chain: Record<string, unknown> = {};
    let table = "";
    const rec = () => chain;
    Object.assign(chain, {
      from: (t: string) => {
        table = t;
        return chain;
      },
      select: rec,
      eq: rec,
      neq: rec,
      not: rec,
      in: (_col: string, ids: string[]) => {
        if (table === "workspace_members") state.probed = ids;
        return chain;
      },
      then: (resolve: (r: unknown) => void) => {
        const data =
          table === "workspaces"
            ? state.owned
            : table === "workspace_members"
              ? state.coMembers
              : [];
        resolve({ data, error: null });
      },
    });
    return {
      from: chain.from,
      storage: { from: () => ({ list: async () => ({ data: [] }) }) },
      auth: {
        admin: {
          deleteUser: async () => {
            state.deleted = true;
            return { error: null };
          },
        },
      },
    };
  },
}));

import { DELETE } from "./route";

function ws(id: string, kind?: string) {
  return { id, name: `${id} workspace`, ...(kind ? { kind } : {}) };
}

async function run(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await DELETE(
    new NextRequest("http://localhost/api/user/delete", { method: "DELETE" }), { params: Promise.resolve({}) }
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.owned = [];
  state.coMembers = [];
  state.probed = null;
  state.deleted = false;
});

describe("owned-workspace guard", () => {
  it("a link container with its peer never blocks the delete", async () => {
    state.owned = [ws("ws-link", "link")];
    state.coMembers = [{ workspace_id: "ws-link" }];

    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(state.deleted).toBe(true);
    // Not merely tolerated in the verdict — never asked about.
    expect(state.probed).toBeNull();
  });

  it("still refuses a STANDARD workspace with co-members", async () => {
    state.owned = [ws("ws-real", "standard")];
    state.coMembers = [{ workspace_id: "ws-real" }];

    const { status, body } = await run();
    expect(status).toBe(409);
    expect(body.code).toBe("OWNER_HAS_SHARED_WORKSPACES");
    expect(body.workspaces).toEqual(["ws-real workspace"]);
    expect(state.deleted).toBe(false);
  });

  it("kind-less rows behave exactly as before the column (migration unapplied)", async () => {
    state.owned = [ws("ws-legacy")];
    state.coMembers = [{ workspace_id: "ws-legacy" }];

    const { status, body } = await run();
    expect(status).toBe(409);
    expect(body.workspaces).toEqual(["ws-legacy workspace"]);
  });

  it("names only the SHARED standard workspace when a container sits beside it", async () => {
    state.owned = [ws("ws-link", "link"), ws("ws-real", "standard")];
    state.coMembers = [{ workspace_id: "ws-link" }, { workspace_id: "ws-real" }];

    const { status, body } = await run();
    expect(status).toBe(409);
    // The container is absent from the probe AND from the message.
    expect(state.probed).toEqual(["ws-real"]);
    expect(body.workspaces).toEqual(["ws-real workspace"]);
  });

  it("a solo standard workspace still deletes", async () => {
    state.owned = [ws("ws-solo", "standard")];
    state.coMembers = [];

    expect((await run()).status).toBe(200);
    expect(state.deleted).toBe(true);
  });
});
