import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  connectIntegration,
  disconnectIntegration,
  finalizeConnectionCallback,
  getIntegrationStatus,
  listIntegrationObjects,
  listIntegrationsForUser,
  updateConnectionGrants,
} from "./service";
import {
  _resetToolkitCacheForTests,
  executeIntegrationAction,
  listIntegrationActions,
} from "./service-actions";
import {
  IntegrationActionNotFoundError,
  IntegrationActionValidationError,
  IntegrationNotConnectedError,
  IntegrationReadNotSupportedError,
} from "./errors";
import type { ComposioClient } from "./composio-client";

// ── Fake DB ─────────────────────────────────────────────────────────
//
// Models the two tables we exercise (oauth_connections,
// oauth_connection_grants) plus a tiny stub for the workspaces lookup
// `listMyWorkspaces` falls back to. The fake supports the .from().
// .select().eq()... chain shape we use across the service module,
// plus the multi-row `in()` filter and joined `oauth_connection_grants!inner`
// pattern from `findConnectionForWorkspace`.

type Conn = {
  id: string;
  user_id: string;
  provider: string;
  alias: string;
  composio_connection_id: string;
  status: "connected" | "needs_auth" | "error";
  account_email: string | null;
  account_label: string | null;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

type Grant = { connection_id: string; workspace_id: string; granted_at: string };

function makeStubDb(initial: { conns?: Conn[]; grants?: Grant[] } = {}) {
  const conns: Conn[] = [...(initial.conns ?? [])];
  const grants: Grant[] = [...(initial.grants ?? [])];

  function makeBuilder(table: "oauth_connections" | "oauth_connection_grants") {
    type FilterFn = (row: Record<string, unknown>) => boolean;
    const filters: FilterFn[] = [];
    let joinedTable: string | null = null;
    let columnsSelected = "*";
    const builder = {
      select(cols: string) {
        columnsSelected = cols;
        // Detect `oauth_connection_grants!inner(workspace_id)` — used by
        // findConnectionForWorkspace to require a grant exists for this
        // workspace. We model the join as a row-level filter against the
        // grants table.
        const joinMatch = cols.match(
          /oauth_connection_grants!inner/
        );
        if (joinMatch) joinedTable = "oauth_connection_grants";
        return builder;
      },
      eq(col: string, val: unknown) {
        if (col.startsWith("oauth_connection_grants.")) {
          const realCol = col.replace("oauth_connection_grants.", "");
          filters.push((row) => {
            const id = row.id as string;
            return grants.some(
              (g) =>
                g.connection_id === id &&
                (g as unknown as Record<string, unknown>)[realCol] === val
            );
          });
          return builder;
        }
        filters.push((r) => r[col] === val);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col] as unknown));
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      async maybeSingle() {
        const row = pickRow();
        return { data: row ?? null, error: null };
      },
      async single() {
        const row = pickRow();
        return { data: row ?? null, error: null };
      },
      async then(resolve: (val: { data: unknown; error: null }) => unknown) {
        // Allow `await builder` — used by `listConnectionsForUser` etc.
        const rows = pickRows();
        return resolve({ data: rows, error: null });
      },
      upsert(payload: Partial<Conn>) {
        if (table !== "oauth_connections")
          throw new Error("upsert only modeled for oauth_connections");
        const idx = conns.findIndex(
          (c) =>
            c.user_id === payload.user_id &&
            c.provider === payload.provider &&
            c.alias === payload.alias
        );
        const now = new Date().toISOString();
        const next: Conn = {
          id: idx >= 0 ? conns[idx].id : `conn-${conns.length + 1}`,
          user_id: payload.user_id!,
          provider: payload.provider!,
          alias: payload.alias!,
          composio_connection_id: payload.composio_connection_id!,
          status: (payload.status ?? "needs_auth") as Conn["status"],
          account_email: payload.account_email ?? null,
          account_label: payload.account_label ?? null,
          scopes: payload.scopes ?? [],
          last_used_at: null,
          created_at: idx >= 0 ? conns[idx].created_at : now,
          updated_at: now,
        };
        if (idx >= 0) conns[idx] = next;
        else conns.push(next);
        return {
          select: () => ({
            async single() {
              return { data: next, error: null };
            },
            async maybeSingle() {
              return { data: next, error: null };
            },
          }),
        };
      },
      update(patch: Partial<Conn>) {
        return {
          eq(col: string, val: unknown) {
            const target = (
              table === "oauth_connections" ? conns : grants
            ).find(
              (r) => (r as unknown as Record<string, unknown>)[col] === val
            );
            if (target) Object.assign(target, patch);
            return Promise.resolve({ error: null });
          },
        };
      },
      delete() {
        // Chainable filter accumulator: supports .eq().eq().like()...
        // and resolves on `await` (then) or any terminal call.
        const deleteFilters: FilterFn[] = [];
        const chain = {
          eq(col: string, val: unknown) {
            deleteFilters.push((r) => r[col] === val);
            return chain;
          },
          like(col: string, pattern: string) {
            // Convert SQL LIKE `pattern%` to regex.
            const escaped = pattern
              .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
              .replace(/%/g, ".*")
              .replace(/_/g, ".");
            const re = new RegExp(`^${escaped}$`);
            deleteFilters.push((r) => {
              const v = r[col];
              return typeof v === "string" && re.test(v);
            });
            return chain;
          },
          then(resolve: (val: { error: null }) => unknown) {
            applyDelete();
            return Promise.resolve(resolve({ error: null }));
          },
        };
        function applyDelete() {
          if (table === "oauth_connections") {
            const dropIds: string[] = [];
            for (let i = conns.length - 1; i >= 0; i--) {
              if (deleteFilters.every((f) => f(conns[i] as unknown as Record<string, unknown>))) {
                dropIds.push(conns[i].id);
                conns.splice(i, 1);
              }
            }
            for (const id of dropIds) {
              for (let i = grants.length - 1; i >= 0; i--) {
                if (grants[i].connection_id === id) grants.splice(i, 1);
              }
            }
          } else {
            for (let i = grants.length - 1; i >= 0; i--) {
              if (deleteFilters.every((f) => f(grants[i] as unknown as Record<string, unknown>)))
                grants.splice(i, 1);
            }
          }
        }
        return chain;
      },
    };

    function pickRows(): unknown[] {
      const base =
        table === "oauth_connections"
          ? (conns as unknown as Record<string, unknown>[])
          : (grants as unknown as Record<string, unknown>[]);
      const filtered = base.filter((r) => filters.every((f) => f(r)));
      void joinedTable;
      void columnsSelected;
      return filtered;
    }
    function pickRow(): unknown {
      const all = pickRows();
      return all[0] ?? null;
    }
    return builder;
  }

  return {
    conns,
    grants,
    from(table: string) {
      if (table !== "oauth_connections" && table !== "oauth_connection_grants") {
        throw new Error(`unexpected table: ${table}`);
      }
      return makeBuilder(table);
    },
    insert(rows: Grant[]) {
      grants.push(...rows);
      return Promise.resolve({ error: null });
    },
  };
}

// `oauth_connection_grants` insert path uses .from(table).insert(rows).
// Patch the stub by intercepting insert at the table level. Cast
// loosely — this is test-fixture plumbing, not production typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function patchGrantInsert(stub: ReturnType<typeof makeStubDb>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalFrom = (stub.from as any).bind(stub);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stub as any).from = (table: string) => {
    const builder = originalFrom(table);
    if (table === "oauth_connection_grants") {
      builder.insert = async (rows: Grant[]) => {
        stub.grants.push(...rows);
        return { error: null };
      };
      builder.upsert = async (rows: Grant[]) => {
        for (const row of rows) {
          if (
            !stub.grants.some(
              (g) =>
                g.connection_id === row.connection_id &&
                g.workspace_id === row.workspace_id
            )
          ) {
            stub.grants.push({ ...row, granted_at: new Date().toISOString() });
          }
        }
        return { error: null };
      };
    }
    return builder;
  };
  return stub;
}

function makeFakeBroker(overrides: Partial<ComposioClient> = {}): ComposioClient {
  return {
    initiateConnection: vi.fn().mockResolvedValue({
      status: "needs_auth",
      authUrl: "https://broker.example/oauth/start",
      brokerConnectionId: "cc_pending_1",
    }),
    getConnectionStatus: vi
      .fn()
      .mockResolvedValue({ status: "connected" as const }),
    getConnectedAccount: vi.fn().mockResolvedValue({
      status: "connected" as const,
      accountEmail: "alice@example.com",
      accountLabel: "Alice",
    }),
    listObjects: vi.fn().mockResolvedValue({ objects: [], nextCursor: null }),
    fetchObject: vi.fn().mockResolvedValue({
      title: "Page",
      url: null,
      body: "body",
      lastModified: null,
    }),
    deleteConnection: vi.fn().mockResolvedValue(undefined),
    purgeAccountsFor: vi.fn().mockResolvedValue(0),
    executeAction: vi
      .fn()
      .mockResolvedValue({ raw: { id: "msg_1", threadId: "thr_1" } }),
    listToolkitTools: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// ── listMyWorkspaces stub ───────────────────────────────────────────
//
// finalizeConnectionRow calls listMyWorkspaces() to auto-grant. We mock
// it via a vi.mock on the workspaces service module.
vi.mock("@/features/workspaces/server/service", () => ({
  listMyWorkspaces: vi.fn(async () => [
    { id: "ws-a", slug: "ws-a", name: "Workspace A" },
    { id: "ws-b", slug: "ws-b", name: "Workspace B" },
  ]),
}));

beforeEach(() => {
  vi.stubEnv("INTEGRATIONS_NOTION_AUTH_CONFIG_ID", "auth_test");
  vi.stubEnv("INTEGRATIONS_GMAIL_AUTH_CONFIG_ID", "auth_test");
  vi.stubEnv("INTEGRATIONS_GOOGLE_DRIVE_AUTH_CONFIG_ID", "auth_test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://test.dopl.local");
  _resetToolkitCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const ctx = { userId: "user-1", provider: "notion" as const };

// ── connectIntegration ───────────────────────────────────────────────

describe("connectIntegration", () => {
  it("calls broker.initiateConnection with allowMultiple and persists a needs_auth row", async () => {
    const stub = patchGrantInsert(makeStubDb());
    const broker = makeFakeBroker();
    const result = await connectIntegration(ctx, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: stub as any,
      broker,
    });
    expect(broker.initiateConnection).toHaveBeenCalledWith({
      entityId: "user-1",
      authConfigId: "auth_test",
      callbackUrl: "https://test.dopl.local/api/integrations/notion/callback",
      allowMultiple: true,
    });
    expect(result).toMatchObject({
      status: "needs_auth",
      authUrl: "https://broker.example/oauth/start",
    });
    expect(stub.conns).toHaveLength(1);
    expect(stub.conns[0].alias).toBe("pending:cc_pending_1");
    expect(stub.conns[0].status).toBe("needs_auth");
  });
});

// ── finalizeConnectionCallback ──────────────────────────────────────

describe("finalizeConnectionCallback", () => {
  it("derives alias from broker email and grants every user workspace", async () => {
    const stub = patchGrantInsert(
      makeStubDb({
        conns: [
          {
            id: "conn-1",
            user_id: "user-1",
            provider: "gmail",
            alias: "pending:cc_x",
            composio_connection_id: "cc_x",
            status: "needs_auth",
            account_email: null,
            account_label: null,
            scopes: [],
            last_used_at: null,
            created_at: "now",
            updated_at: "now",
          },
        ],
      })
    );
    const broker = makeFakeBroker();
    const out = await finalizeConnectionCallback(
      { brokerConnectionId: "cc_x" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any, broker }
    );
    expect(out).toEqual({ provider: "gmail", status: "connected" });
    expect(stub.conns[0].status).toBe("connected");
    expect(stub.conns[0].alias).toBe("alice@example.com");
    expect(stub.conns[0].account_email).toBe("alice@example.com");
    expect((stub.grants as Grant[]).map((g) => g.workspace_id).sort()).toEqual([
      "ws-a",
      "ws-b",
    ]);
  });
});

// ── status ───────────────────────────────────────────────────────────

describe("getIntegrationStatus", () => {
  it("returns disconnected when there's no row", async () => {
    const stub = makeStubDb();
    const result = await getIntegrationStatus(
      { userId: "user-1", provider: "notion", workspaceId: "ws-a" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any, broker: makeFakeBroker() }
    );
    expect(result).toEqual({ status: "disconnected" });
  });

  it("returns disconnected when the connection isn't granted to this workspace", async () => {
    const stub = patchGrantInsert(
      makeStubDb({
        conns: [
          {
            id: "conn-1",
            user_id: "user-1",
            provider: "notion",
            alias: "alice@example.com",
            composio_connection_id: "cc_live",
            status: "connected",
            account_email: "alice@example.com",
            account_label: null,
            scopes: [],
            last_used_at: null,
            created_at: "now",
            updated_at: "now",
          },
        ],
        // Granted only to ws-other, NOT ws-a.
        grants: [
          { connection_id: "conn-1", workspace_id: "ws-other", granted_at: "now" },
        ],
      })
    );
    const result = await getIntegrationStatus(
      { userId: "user-1", provider: "notion", workspaceId: "ws-a" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any, broker: makeFakeBroker() }
    );
    expect(result).toEqual({ status: "disconnected" });
  });
});

// ── listIntegrationObjects ──────────────────────────────────────────

describe("listIntegrationObjects", () => {
  it("throws IntegrationReadNotSupportedError for write-only providers", async () => {
    const stub = makeStubDb();
    await expect(
      listIntegrationObjects(
        { workspaceId: "ws-a", userId: "user-1", provider: "slack" },
        {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: stub as any, broker: makeFakeBroker() }
      )
    ).rejects.toBeInstanceOf(IntegrationReadNotSupportedError);
  });

  it("throws IntegrationNotConnectedError when no live granted connection", async () => {
    const stub = makeStubDb();
    await expect(
      listIntegrationObjects(
        { workspaceId: "ws-a", userId: "user-1", provider: "notion" },
        {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: stub as any, broker: makeFakeBroker() }
      )
    ).rejects.toBeInstanceOf(IntegrationNotConnectedError);
  });
});

// ── grants management ────────────────────────────────────────────────

describe("updateConnectionGrants", () => {
  it("replaces the grants set for a connection owned by the user", async () => {
    const stub = patchGrantInsert(
      makeStubDb({
        conns: [
          {
            id: "conn-1",
            user_id: "user-1",
            provider: "notion",
            alias: "alice@example.com",
            composio_connection_id: "cc_live",
            status: "connected",
            account_email: null,
            account_label: null,
            scopes: [],
            last_used_at: null,
            created_at: "now",
            updated_at: "now",
          },
        ],
        grants: [
          { connection_id: "conn-1", workspace_id: "ws-a", granted_at: "now" },
          { connection_id: "conn-1", workspace_id: "ws-b", granted_at: "now" },
        ],
      })
    );
    const result = await updateConnectionGrants(
      {
        userId: "user-1",
        connectionId: "conn-1",
        workspaceIds: ["ws-b"],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any }
    );
    expect(result.grantedWorkspaceIds).toEqual(["ws-b"]);
    expect((stub.grants as Grant[]).map((g) => g.workspace_id)).toEqual(["ws-b"]);
  });
});

// ── disconnect ───────────────────────────────────────────────────────

describe("disconnectIntegration", () => {
  it("deletes the row + cascades grants when caller owns the connection", async () => {
    const stub = patchGrantInsert(
      makeStubDb({
        conns: [
          {
            id: "conn-1",
            user_id: "user-1",
            provider: "gmail",
            alias: "alice@example.com",
            composio_connection_id: "cc_live",
            status: "connected",
            account_email: null,
            account_label: null,
            scopes: [],
            last_used_at: null,
            created_at: "now",
            updated_at: "now",
          },
        ],
        grants: [
          { connection_id: "conn-1", workspace_id: "ws-a", granted_at: "now" },
        ],
      })
    );
    await disconnectIntegration(
      { userId: "user-1", connectionId: "conn-1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any }
    );
    expect(stub.conns).toHaveLength(0);
    expect(stub.grants).toHaveLength(0);
  });

  it("no-ops when caller doesn't own the connection", async () => {
    const stub = patchGrantInsert(
      makeStubDb({
        conns: [
          {
            id: "conn-1",
            user_id: "user-2",
            provider: "gmail",
            alias: "bob@example.com",
            composio_connection_id: "cc_live",
            status: "connected",
            account_email: null,
            account_label: null,
            scopes: [],
            last_used_at: null,
            created_at: "now",
            updated_at: "now",
          },
        ],
      })
    );
    await disconnectIntegration(
      { userId: "user-1", connectionId: "conn-1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any }
    );
    expect(stub.conns).toHaveLength(1);
  });
});

// ── listIntegrationActions / executeIntegrationAction (auto-map) ─────

describe("listIntegrationActions query filter", () => {
  it("substring-matches name and summary case-insensitively", async () => {
    const broker = makeFakeBroker({
      listToolkitTools: vi.fn().mockResolvedValue([
        {
          slug: "GMAIL_CREATE_FILTER",
          description: "Create a Gmail filter.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          slug: "GMAIL_LIST_LABELS",
          description: "List every label.",
          inputSchema: { type: "object", properties: {} },
        },
      ]),
    });
    const filtered = await listIntegrationActions(
      "gmail",
      { broker },
      { query: "label" }
    );
    // Curated (send_email, reply_to_thread) drop out — query "label"
    // matches list_labels only.
    expect(filtered.map((a) => a.name)).toEqual(["list_labels"]);
  });

  it("returns empty array when no actions match the query", async () => {
    const broker = makeFakeBroker();
    const filtered = await listIntegrationActions(
      "gmail",
      { broker },
      { query: "nothing-matches-this" }
    );
    expect(filtered).toEqual([]);
  });
});

describe("listIntegrationActions", () => {
  it("returns curated entries first, then auto entries from the broker catalog", async () => {
    const broker = makeFakeBroker({
      listToolkitTools: vi.fn().mockResolvedValue([
        {
          slug: "GMAIL_CREATE_FILTER",
          description: "Create a Gmail filter.",
          inputSchema: { type: "object", required: ["criteria"], properties: {} },
        },
        {
          slug: "GMAIL_SEND_EMAIL",
          description: "Composio's stock send-email — should be hidden by curated override.",
          inputSchema: { type: "object", properties: {} },
        },
      ]),
    });
    const actions = await listIntegrationActions("gmail", { broker });
    const names = actions.map((a) => a.name);
    expect(names).toContain("send_email");
    expect(names).toContain("create_filter");
    expect(names.filter((n) => n === "send_email")).toHaveLength(1);
  });
});

describe("executeIntegrationAction", () => {
  function connectedFixture() {
    return patchGrantInsert(
      makeStubDb({
        conns: [
          {
            id: "conn-1",
            user_id: "user-1",
            provider: "gmail",
            alias: "alice@example.com",
            composio_connection_id: "cc_live",
            status: "connected",
            account_email: null,
            account_label: null,
            scopes: [],
            last_used_at: null,
            created_at: "now",
            updated_at: "now",
          },
        ],
        grants: [
          { connection_id: "conn-1", workspace_id: "ws-a", granted_at: "now" },
        ],
      })
    );
  }

  it("dispatches send_email to the broker with mapped Composio args", async () => {
    const stub = connectedFixture();
    const exec = vi
      .fn()
      .mockResolvedValue({ raw: { id: "msg_a", threadId: "thr_a" } });
    const broker = makeFakeBroker({ executeAction: exec });
    const result = await executeIntegrationAction(
      { workspaceId: "ws-a", userId: "user-1", provider: "gmail" },
      {
        action: "send_email",
        params: { to: "alice@example.com", subject: "Hi", body: "Hello" },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any, broker }
    );
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gmail",
        slug: "GMAIL_SEND_EMAIL",
        brokerConnectionId: "cc_live",
        entityId: "user-1",
      })
    );
    expect(result).toEqual({
      ok: true,
      data: { id: "msg_a", thread_id: "thr_a" },
    });
  });

  it("throws IntegrationActionNotFoundError for an unknown action", async () => {
    const stub = connectedFixture();
    await expect(
      executeIntegrationAction(
        { workspaceId: "ws-a", userId: "user-1", provider: "gmail" },
        { action: "delete_inbox", params: {} },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: stub as any, broker: makeFakeBroker() }
      )
    ).rejects.toBeInstanceOf(IntegrationActionNotFoundError);
  });

  it("throws IntegrationActionValidationError when curated params don't match", async () => {
    const stub = connectedFixture();
    await expect(
      executeIntegrationAction(
        { workspaceId: "ws-a", userId: "user-1", provider: "gmail" },
        { action: "send_email", params: { to: "x@y.com", subject: "Hi" } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: stub as any, broker: makeFakeBroker() }
      )
    ).rejects.toBeInstanceOf(IntegrationActionValidationError);
  });

  it("throws IntegrationNotConnectedError when there's no granted connection", async () => {
    const stub = makeStubDb();
    await expect(
      executeIntegrationAction(
        { workspaceId: "ws-a", userId: "user-1", provider: "gmail" },
        {
          action: "send_email",
          params: { to: "a@b.c", subject: "s", body: "b" },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: stub as any, broker: makeFakeBroker() }
      )
    ).rejects.toBeInstanceOf(IntegrationNotConnectedError);
  });
});

// ── B3 regression: alias filter when multiple connections share workspace ─

describe("findConnectionForWorkspace alias filter (B3 regression)", () => {
  it("matches by alias even when another connection's row sorts ahead", async () => {
    const stub = patchGrantInsert(
      makeStubDb({
        conns: [
          {
            id: "conn-newer",
            user_id: "user-1",
            provider: "gmail",
            // Sort priority: newer wins via created_at desc, then last_used.
            alias: "alice@example.com",
            composio_connection_id: "cc_newer",
            status: "connected",
            account_email: "alice@example.com",
            account_label: null,
            scopes: [],
            last_used_at: null,
            created_at: "2026-05-05T00:00:00Z",
            updated_at: "2026-05-05T00:00:00Z",
          },
          {
            id: "conn-older",
            user_id: "user-1",
            provider: "gmail",
            alias: "work@example.com",
            composio_connection_id: "cc_older",
            status: "connected",
            account_email: "work@example.com",
            account_label: null,
            scopes: [],
            last_used_at: null,
            created_at: "2026-05-04T00:00:00Z",
            updated_at: "2026-05-04T00:00:00Z",
          },
        ],
        grants: [
          { connection_id: "conn-newer", workspace_id: "ws-a", granted_at: "now" },
          { connection_id: "conn-older", workspace_id: "ws-a", granted_at: "now" },
        ],
      })
    );
    // Asking for the older connection by alias must return its row,
    // not the newer one that sorts first. (Old code did .limit(1)
    // before applying alias and would wrongly miss this.)
    const exec = vi.fn().mockResolvedValue({ raw: { id: "x", threadId: "y" } });
    const broker = makeFakeBroker({ executeAction: exec });
    await executeIntegrationAction(
      { workspaceId: "ws-a", userId: "user-1", provider: "gmail" },
      {
        action: "send_email",
        params: { to: "x@y.com", subject: "s", body: "b" },
        alias: "work@example.com",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any, broker }
    );
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({ brokerConnectionId: "cc_older" })
    );
  });
});

// ── listIntegrationsForUser ─────────────────────────────────────────

describe("listIntegrationsForUser", () => {
  it("hydrates each connection with its workspace grant ids", async () => {
    const stub = patchGrantInsert(
      makeStubDb({
        conns: [
          {
            id: "conn-1",
            user_id: "user-1",
            provider: "gmail",
            alias: "alice@example.com",
            composio_connection_id: "cc_live",
            status: "connected",
            account_email: "alice@example.com",
            account_label: null,
            scopes: [],
            last_used_at: null,
            created_at: "now",
            updated_at: "now",
          },
        ],
        grants: [
          { connection_id: "conn-1", workspace_id: "ws-a", granted_at: "now" },
          { connection_id: "conn-1", workspace_id: "ws-b", granted_at: "now" },
        ],
      })
    );
    const out = await listIntegrationsForUser(
      { userId: "user-1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any }
    );
    expect(out).toHaveLength(1);
    expect(out[0].grantedWorkspaceIds.sort()).toEqual(["ws-a", "ws-b"]);
  });
});
