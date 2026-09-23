/**
 * 🔒 **THE LOOKUP HALF OF THE GRANT ARM** (F-604) — which grant rows admit a
 * HUMAN read, and how many queries it costs to find out.
 *
 * ⚠ **THE LEVEL RULE IS THE POINT OF THIS FILE.** `channel` grants carry
 * `agent_only | visible` — two AUDIENCES, not a high/low pair
 * (`20260827120000`) — and `agent_only` names no human audience. The SQL twin's
 * half of that rule is asserted structurally in
 * `features/knowledge/server/rls-redteam.test.ts`; **without this file the TS
 * half would have had no test at all**, which is the asymmetry §5A's "one rule
 * written twice" warning is about.
 *
 * ⚠ The Supabase client is faked rather than mocked per method: the shape under
 * test is a CHAIN, and a per-method mock proves the calls happened without
 * proving they composed.
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
        then(resolve: (r: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve(
            resolve({ data: rows[table] ?? [], error: null })
          );
        },
      };
      return builder;
    },
  }),
}));

const { grantedResourceIds, NO_GRANTS } = await import("./resource-grant-reach");

const CONTAINER = { scope_type: "container", scope_id: "ws-b", level: "read" };
const CHANNEL = { scope_type: "channel", scope_id: "ch-1" };

/**
 * 🔒 The rows `channel-scope.ts › channelsWhereScopeIsIgnored` reads, for a
 * channel whose container is a HOME one (Samuel's ruling 2026-09-17). ⚠ EVERY
 * channel case in this file needs them: without a resolvable container the
 * helper fails CLOSED and the grant is ignored, which is the whole point.
 */
function homeChannel(channelId = "ch-1", kind = "link") {
  return {
    channels: [{ id: channelId, workspace_id: "ws-home" }],
    workspaces: [{ id: "ws-home", kind }],
  };
}

beforeEach(() => {
  rows = {};
  seen = [];
});

describe("grantedResourceIds", () => {
  it("asks NOTHING when there is nothing to ask about", async () => {
    expect(await grantedResourceIds("u-1", "knowledge_base", [])).toBe(NO_GRANTS);
    expect(seen).toHaveLength(0);
  });

  it("a CONTAINER grant admits a member of that container, at either level", async () => {
    for (const level of ["read", "edit"]) {
      seen = [];
      rows = {
        resource_grants: [{ ...CONTAINER, level, resource_id: "kb-1" }],
        workspace_members: [{ workspace_id: "ws-b", role: "member" }],
      };
      const granted = await grantedResourceIds("u-1", "knowledge_base", ["kb-1"]);
      expect([...granted], level).toEqual(["kb-1"]);
    }
  });

  it("…and NOT a non-member: the membership read is the fence", async () => {
    rows = {
      resource_grants: [{ ...CONTAINER, resource_id: "kb-1" }],
      workspace_members: [],
    };
    expect(await grantedResourceIds("u-1", "knowledge_base", ["kb-1"])).toBe(
      NO_GRANTS
    );
  });

  it("🔒 …and NOT a GUEST, who ranks below the read floor", async () => {
    rows = {
      resource_grants: [{ ...CONTAINER, resource_id: "kb-1" }],
      workspace_members: [{ workspace_id: "ws-b", role: "guest" }],
    };
    expect(await grantedResourceIds("u-1", "knowledge_base", ["kb-1"])).toBe(
      NO_GRANTS
    );
  });

  it("🔒 a CHANNEL grant at `visible` admits a channel member; `agent_only` does NOT", async () => {
    rows = {
      resource_grants: [
        { ...CHANNEL, level: "visible", resource_id: "kb-visible" },
        { ...CHANNEL, level: "agent_only", resource_id: "kb-agent-only" },
      ],
      channel_members: [{ channel_id: "ch-1" }],
      ...homeChannel(),
    };
    const granted = await grantedResourceIds("u-1", "knowledge_base", [
      "kb-visible",
      "kb-agent-only",
    ]);
    expect([...granted]).toEqual(["kb-visible"]);
  });

  it("🔒 the level filter runs BEFORE the membership read, so `agent_only` costs no query", async () => {
    rows = {
      resource_grants: [{ ...CHANNEL, level: "agent_only", resource_id: "kb-1" }],
      channel_members: [{ channel_id: "ch-1" }],
    };
    expect(await grantedResourceIds("u-1", "knowledge_base", ["kb-1"])).toBe(
      NO_GRANTS
    );
    expect(seen.map((f) => f.table)).toEqual(["resource_grants"]);
  });

  it("🔒 asks only for `channel` and `container`, and NEVER narrows by workspace", async () => {
    rows = { resource_grants: [] };
    await grantedResourceIds("u-1", "agent_identity", ["t-1"]);
    const [grants] = seen;
    expect(grants.in.scope_type).toEqual(["channel", "container"]);
    expect(grants.eq.resource_type).toBe("agent_identity");
    // 🔒 A grant row is filed under the RESOURCE's container while the caller
    // reaches it through the SCOPE's — a `workspace_id` term would refuse the
    // cross-container lend this function exists to honour.
    expect(grants.eq.workspace_id).toBeUndefined();
  });

  /**
   * 🔒 **SAMUEL'S RULING 2026-09-17** — *"In workspaces, resource access is not
   * scoped by channels. It's instead scoped by teams."*
   *
   * ⚠ **IGNORED, NOT ABSENT.** The row is still in the table (the write doors
   * refuse NEW ones; `20261011120000` converts the OLD ones), so what is under
   * test is that the READ arm drops it — not that nothing wrote it.
   */
  describe("🔒 the container-KIND fence on a channel scope", () => {
    const visible = { ...CHANNEL, level: "visible", resource_id: "kb-1" };

    it("IGNORES a channel grant whose container is a STANDARD workspace", async () => {
      rows = {
        resource_grants: [visible],
        channel_members: [{ channel_id: "ch-1" }],
        channels: [{ id: "ch-1", workspace_id: "ws-std" }],
        workspaces: [{ id: "ws-std", kind: "standard" }],
      };
      expect(await grantedResourceIds("u-1", "knowledge_base", ["kb-1"])).toBe(
        NO_GRANTS
      );
    });

    it("…even though the caller IS a member of that channel", async () => {
      rows = {
        resource_grants: [visible],
        channel_members: [{ channel_id: "ch-1" }],
        channels: [{ id: "ch-1", workspace_id: "ws-std" }],
        workspaces: [{ id: "ws-std", kind: "standard" }],
      };
      const granted = await grantedResourceIds("u-1", "knowledge_base", ["kb-1"]);
      expect([...granted]).toEqual([]);
    });

    it("HONOURS the same grant in a `link` container", async () => {
      rows = {
        resource_grants: [visible],
        channel_members: [{ channel_id: "ch-1" }],
        ...homeChannel(),
      };
      expect([...(await grantedResourceIds("u-1", "knowledge_base", ["kb-1"]))]).toEqual(
        ["kb-1"]
      );
    });

    it("HONOURS it in a `personal` container too — one member, untouched", async () => {
      rows = {
        resource_grants: [visible],
        channel_members: [{ channel_id: "ch-1" }],
        ...homeChannel("ch-1", "personal"),
      };
      expect([...(await grantedResourceIds("u-1", "knowledge_base", ["kb-1"]))]).toEqual(
        ["kb-1"]
      );
    });

    it("🔒 fails CLOSED when the channel row is gone — unknown is not permission", async () => {
      rows = {
        resource_grants: [visible],
        channel_members: [{ channel_id: "ch-1" }],
        channels: [],
        workspaces: [],
      };
      expect(await grantedResourceIds("u-1", "knowledge_base", ["kb-1"])).toBe(
        NO_GRANTS
      );
    });

    it("🔒 an ABSENT `kind` reads as STANDARD and is ignored", async () => {
      rows = {
        resource_grants: [visible],
        channel_members: [{ channel_id: "ch-1" }],
        channels: [{ id: "ch-1", workspace_id: "ws-?" }],
        workspaces: [{ id: "ws-?" }],
      };
      expect(await grantedResourceIds("u-1", "knowledge_base", ["kb-1"])).toBe(
        NO_GRANTS
      );
    });

    it("does NOT touch a CONTAINER grant — only the channel arm is narrowed", async () => {
      rows = {
        resource_grants: [{ ...CONTAINER, resource_id: "kb-1" }],
        workspace_members: [{ workspace_id: "ws-b", role: "member" }],
      };
      expect([...(await grantedResourceIds("u-1", "knowledge_base", ["kb-1"]))]).toEqual(
        ["kb-1"]
      );
      // ⚠ AND IT SPENDS NO KIND READ: a container scope never asks.
      expect(seen.map((f) => f.table)).toEqual([
        "resource_grants",
        "workspace_members",
      ]);
    });
  });

  it("costs at most three queries, and only for the scope kinds that occur", async () => {
    rows = {
      resource_grants: [{ ...CONTAINER, resource_id: "kb-1" }],
      workspace_members: [{ workspace_id: "ws-b", role: "member" }],
    };
    await grantedResourceIds("u-1", "knowledge_base", ["kb-1", "kb-2", "kb-1"]);
    expect(seen.map((f) => f.table)).toEqual(["resource_grants", "workspace_members"]);
    // De-duped: a row set naming the same id twice asks about it once.
    expect(seen[0].in.resource_id).toEqual(["kb-1", "kb-2"]);
  });
});
