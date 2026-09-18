/**
 * 🔒 **THE CONTAINER-KIND FENCE ON A CHANNEL SCOPE** — Samuel's ruling
 * 2026-09-17: *"In workspaces, resource access is not scoped by channels. It's
 * instead scoped by teams."*
 *
 * ⚠ **THE SPELLING IS THE PROPERTY, NOT THE OUTCOME.** Both `standard` and
 * `link` behave the way an eyeball expects; what this file exists to pin is the
 * THIRD and FOURTH answers — an unknown future kind, and an ABSENT one — where
 * `isStandardWorkspace`'s positive form (§4A, F-295) and a `<> 'link'` spelling
 * give OPPOSITE results and neither fails loudly.
 *
 * ⚠ The Supabase client is faked rather than mocked per method, for the reason
 * `resource-grant-reach.test.ts` states: the shape under test is a CHAIN.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

interface Filter {
  table: string;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
}

let rows: Record<string, unknown[]>;
let seen: Filter[];

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const filter: Filter = { table, eq: {}, in: {} };
      seen.push(filter);
      const builder = {
        select: () => builder,
        eq(col: string, value: unknown) {
          filter.eq[col] = value;
          return builder;
        },
        in(col: string, values: unknown[]) {
          filter.in[col] = values;
          return builder;
        },
        limit: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null }),
        then(resolve: (r: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: rows[table] ?? [], error: null }));
        },
      };
      return builder;
    },
  }),
}));

const {
  SCOPE_NOT_ALLOWED_IN_WORKSPACE,
  assertChannelScopeAllowedInContainer,
  channelScopeAllowedInContainer,
  channelScopeRefusal,
  channelsWhereScopeIsIgnored,
} = await import("./channel-scope");

beforeEach(() => {
  rows = {};
  seen = [];
});

// ── The WRITE door ────────────────────────────────────────────────────────

describe("channelScopeAllowedInContainer", () => {
  it("REFUSES a standard workspace — the ruling", async () => {
    rows = { workspaces: [{ kind: "standard" }] };
    expect(await channelScopeAllowedInContainer("ws-1")).toBe(false);
  });

  it("ALLOWS a `link` container — Samuel's home-sharing model, unchanged", async () => {
    rows = { workspaces: [{ kind: "link" }] };
    expect(await channelScopeAllowedInContainer("ws-1")).toBe(true);
  });

  it("ALLOWS a `personal` container — one member, untouched", async () => {
    rows = { workspaces: [{ kind: "personal" }] };
    expect(await channelScopeAllowedInContainer("ws-1")).toBe(true);
  });

  it("🔒 an ABSENT kind reads as STANDARD and REFUSES", async () => {
    // ⚠ THE MUTATION THIS CATCHES is spelling the test `kind === 'link'`, which
    // passes every case above and flips this one. `kind` is `NOT NULL DEFAULT
    // 'standard'` (§4A), so absent means standard everywhere else too.
    rows = { workspaces: [{}] };
    expect(await channelScopeAllowedInContainer("ws-1")).toBe(false);
  });

  it("🔒 a MISSING container REFUSES — a vanished row is not permission", async () => {
    rows = { workspaces: [] };
    expect(await channelScopeAllowedInContainer("ws-1")).toBe(false);
  });

  it("⚠ an UNKNOWN FUTURE kind is ALLOWED, deliberately", async () => {
    // The rule is "a STANDARD workspace refuses", not "only link admits". A kind
    // nobody has designed yet is not a standard workspace, and refusing one
    // would be the same guess `repository-audience.ts › findWorkspaceKind`
    // refuses to make from the other side.
    rows = { workspaces: [{ kind: "something-new" }] };
    expect(await channelScopeAllowedInContainer("ws-1")).toBe(true);
  });

  it("asserts by throwing the NAMED refusal, not a bare 400", async () => {
    rows = { workspaces: [{ kind: "standard" }] };
    await expect(assertChannelScopeAllowedInContainer("ws-1")).rejects.toMatchObject({
      status: 400,
      code: SCOPE_NOT_ALLOWED_IN_WORKSPACE,
    });
  });

  it("asserts silently when the container admits channel scope", async () => {
    rows = { workspaces: [{ kind: "link" }] };
    await expect(
      assertChannelScopeAllowedInContainer("ws-1")
    ).resolves.toBeUndefined();
  });

  it("🔒 the refusal NAMES THE RULE and the remedy", async () => {
    // ⚠ A caller told only "forbidden" goes and greps the repo. The message must
    // say what the scope IS in a workspace and what to reach for instead.
    const message = channelScopeRefusal().message;
    expect(message).toMatch(/workspace/i);
    expect(message).toMatch(/team/i);
    expect(message).toMatch(/home channel/i);
  });
});

// ── The READ door ─────────────────────────────────────────────────────────

describe("channelsWhereScopeIsIgnored", () => {
  it("asks NOTHING when there is nothing to ask about", async () => {
    expect((await channelsWhereScopeIsIgnored([])).size).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it("names the channels in STANDARD containers and no others", async () => {
    rows = {
      channels: [
        { id: "ch-std", workspace_id: "ws-std" },
        { id: "ch-home", workspace_id: "ws-home" },
      ],
      workspaces: [
        { id: "ws-std", kind: "standard" },
        { id: "ws-home", kind: "link" },
      ],
    };
    const ignored = await channelsWhereScopeIsIgnored(["ch-std", "ch-home"]);
    expect([...ignored]).toEqual(["ch-std"]);
  });

  it("🔒 ignores a channel with NO ROW — fail closed on unknown", async () => {
    rows = { channels: [], workspaces: [] };
    expect([...(await channelsWhereScopeIsIgnored(["ch-gone"]))]).toEqual([
      "ch-gone",
    ]);
  });

  it("🔒 ignores a channel whose CONTAINER row is missing", async () => {
    rows = {
      channels: [{ id: "ch-1", workspace_id: "ws-gone" }],
      workspaces: [],
    };
    expect([...(await channelsWhereScopeIsIgnored(["ch-1"]))]).toEqual(["ch-1"]);
  });

  it("de-dupes the ids it asks about", async () => {
    rows = {
      channels: [{ id: "ch-1", workspace_id: "ws-home" }],
      workspaces: [{ id: "ws-home", kind: "link" }],
    };
    await channelsWhereScopeIsIgnored(["ch-1", "ch-1", "ch-2"]);
    expect(seen[0].in.id).toEqual(["ch-1", "ch-2"]);
  });

  it("spends TWO queries, and the second only when a container resolved", async () => {
    rows = { channels: [], workspaces: [] };
    await channelsWhereScopeIsIgnored(["ch-1"]);
    expect(seen.map((f) => f.table)).toEqual(["channels"]);
  });
});
