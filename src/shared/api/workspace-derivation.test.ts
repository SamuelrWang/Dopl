import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>>, members: new Set<string>() }));

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => { filters[col] = v; return q; },
        maybeSingle: async () => {
          if (table === "workspace_members") {
            const key = `${filters.workspace_id}:${filters.user_id}`;
            return { data: db.members.has(key) && filters.status === "active" ? { user_id: filters.user_id } : null, error: null };
          }
          return { data: db.rows[`${table}:${filters.id}`] ?? null, error: null };
        },
      };
      return q;
    },
  }),
}));

import { deriveWorkspace, noDerivation, rowWorkspace } from "./workspace-derivation";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  db.rows = {};
  db.members = new Set();
});

describe("rowWorkspace", () => {
  const derive = rowWorkspace("knowledge_entries", "entryId");

  it("answers the row's container when the caller is an active member of it", async () => {
    db.rows[`knowledge_entries:${ID}`] = { workspace_id: WS };
    db.members.add(`${WS}:u1`);
    expect(await derive({ entryId: ID }, "u1")).toBe(WS);
  });

  it("null (falls through to home) when the caller is not a member: no existence leak", async () => {
    db.rows[`knowledge_entries:${ID}`] = { workspace_id: WS };
    expect(await derive({ entryId: ID }, "u1")).toBeNull();
  });

  it.each([[{}], [{ entryId: "my-slug" }], [{ entryId: ID }]])("null for a missing, non-uuid or unknown id: %j", async (params) => {
    expect(await derive(params as Record<string, string>, "u1")).toBeNull();
  });
});

describe("families", () => {
  it("every family is a resolver", () => {
    for (const fn of Object.values(deriveWorkspace)) expect(typeof fn).toBe("function");
  });

  it("noDerivation never derives", async () => {
    expect(await noDerivation("slug")({ skillSlug: "x" }, "u1")).toBeNull();
  });
});
