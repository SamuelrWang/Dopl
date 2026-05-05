import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  connectIntegration,
  getIntegrationStatus,
  listIntegrationObjects,
  startBrokerOAuth,
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
import type { IntegrationProvider } from "../types";

type Row = {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: string;
  composio_connection_id: string;
  status: "connected" | "needs_auth" | "error";
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

function makeStubDb(initialRows: Row[]) {
  const rows: Row[] = [...initialRows];
  return {
    rows,
    from(table: string) {
      if (table !== "oauth_connections") {
        throw new Error(`unexpected table: ${table}`);
      }
      const filters: Array<(r: Row) => boolean> = [];
      const builder = {
        select: () => builder,
        eq(col: string, val: unknown) {
          filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val);
          return builder;
        },
        async maybeSingle() {
          const row = rows.find((r) => filters.every((f) => f(r))) ?? null;
          return { data: row, error: null };
        },
        async single() {
          const row = rows.find((r) => filters.every((f) => f(r))) ?? null;
          return { data: row, error: null };
        },
        upsert(payload: Partial<Row>) {
          const idx = rows.findIndex(
            (r) =>
              r.workspace_id === payload.workspace_id &&
              r.user_id === payload.user_id &&
              r.provider === payload.provider
          );
          const next: Row = {
            id: idx >= 0 ? rows[idx].id : "row-" + (rows.length + 1),
            workspace_id: payload.workspace_id!,
            user_id: payload.user_id!,
            provider: payload.provider!,
            composio_connection_id: payload.composio_connection_id!,
            status: (payload.status ?? "needs_auth") as Row["status"],
            scopes: payload.scopes ?? [],
            last_used_at: null,
            created_at:
              idx >= 0 ? rows[idx].created_at : new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          if (idx >= 0) rows[idx] = next;
          else rows.push(next);
          return {
            select: () => ({
              async single() {
                return { data: next, error: null };
              },
            }),
          };
        },
        update(patch: Partial<Row>) {
          return {
            eq(col: string, val: unknown) {
              const found = rows.find(
                (r) => (r as unknown as Record<string, unknown>)[col] === val
              );
              if (found) Object.assign(found, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
        delete() {
          return {
            eq() {
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return builder;
    },
  };
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

const ctx: {
  workspaceId: string;
  userId: string;
  provider: IntegrationProvider;
} = {
  workspaceId: "ws-1",
  userId: "user-1",
  provider: "notion",
};

describe("connectIntegration", () => {
  it("returns connected when an existing row is connected", async () => {
    const stub = makeStubDb([
      {
        id: "row-1",
        workspace_id: ctx.workspaceId,
        user_id: ctx.userId,
        provider: "notion",
        composio_connection_id: "cc_existing",
        status: "connected",
        scopes: [],
        last_used_at: null,
        created_at: "now",
        updated_at: "now",
      },
    ]);
    const broker = makeFakeBroker();
    const result = await connectIntegration(ctx, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: stub as any,
      broker,
    });
    expect(result).toEqual({ status: "connected" });
    expect(broker.initiateConnection).not.toHaveBeenCalled();
  });

  it("returns a Dopl-branded auth URL when no connection exists", async () => {
    const stub = makeStubDb([]);
    const broker = makeFakeBroker();
    const result = await connectIntegration(ctx, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: stub as any,
      broker,
    });
    expect(result).toEqual({
      status: "needs_auth",
      authUrl: "https://test.dopl.local/connect/notion/start",
    });
    expect(broker.initiateConnection).not.toHaveBeenCalled();
  });
});

describe("startBrokerOAuth", () => {
  it("hits the broker and persists a needs_auth row", async () => {
    const stub = makeStubDb([]);
    const broker = makeFakeBroker();
    const result = await startBrokerOAuth(ctx, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: stub as any,
      broker,
    });
    expect(broker.initiateConnection).toHaveBeenCalledWith({
      entityId: "ws-1:user-1",
      authConfigId: "auth_test",
      callbackUrl:
        "https://test.dopl.local/api/integrations/notion/callback?workspace_id=ws-1&user_id=user-1",
    });
    expect(result).toEqual({
      status: "needs_auth",
      brokerAuthUrl: "https://broker.example/oauth/start",
    });
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0].status).toBe("needs_auth");
    expect(stub.rows[0].composio_connection_id).toBe("cc_pending_1");
  });

  it("short-circuits to connected when broker says so", async () => {
    const stub = makeStubDb([]);
    const broker = makeFakeBroker({
      initiateConnection: vi.fn().mockResolvedValue({
        status: "connected",
        brokerConnectionId: "cc_live",
      }),
    });
    const result = await startBrokerOAuth(ctx, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: stub as any,
      broker,
    });
    expect(result).toEqual({ status: "connected" });
    expect(stub.rows[0].status).toBe("connected");
  });
});

describe("getIntegrationStatus", () => {
  it("reports disconnected when there's no row", async () => {
    const stub = makeStubDb([]);
    const result = await getIntegrationStatus(ctx, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: stub as any,
      broker: makeFakeBroker(),
    });
    expect(result).toEqual({ status: "disconnected" });
  });

  it("re-polls the broker when the row is needs_auth and updates on change", async () => {
    const stub = makeStubDb([
      {
        id: "row-1",
        workspace_id: ctx.workspaceId,
        user_id: ctx.userId,
        provider: "notion",
        composio_connection_id: "cc_pending",
        status: "needs_auth",
        scopes: [],
        last_used_at: null,
        created_at: "now",
        updated_at: "now",
      },
    ]);
    const broker = makeFakeBroker();
    const result = await getIntegrationStatus(ctx, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: stub as any,
      broker,
    });
    expect(broker.getConnectionStatus).toHaveBeenCalledWith("cc_pending");
    expect(result).toEqual({ status: "connected" });
    expect(stub.rows[0].status).toBe("connected");
  });
});

describe("listIntegrationActions", () => {
  it("returns curated entries first, then auto entries from the broker catalog", async () => {
    const broker = makeFakeBroker({
      listToolkitTools: vi.fn().mockResolvedValue([
        {
          slug: "GMAIL_CREATE_FILTER",
          description: "Create a Gmail filter.",
          inputSchema: { type: "object", required: ["criteria"], properties: { criteria: { type: "object" } } },
        },
        {
          slug: "GMAIL_SEND_EMAIL",
          description: "Composio's stock send-email — should be hidden by curated override.",
          inputSchema: { type: "object", properties: { recipient_email: { type: "string" } } },
        },
      ]),
    });
    const actions = await listIntegrationActions("gmail", { broker });
    const names = actions.map((a) => a.name);
    expect(names).toContain("send_email");
    expect(names).toContain("reply_to_thread");
    expect(names).toContain("create_filter");
    // GMAIL_SEND_EMAIL → send_email collides with the curated override;
    // it must NOT appear twice.
    expect(names.filter((n) => n === "send_email")).toHaveLength(1);
    const send = actions.find((a) => a.name === "send_email");
    expect(send?.source).toBe("curated");
    const filter = actions.find((a) => a.name === "create_filter");
    expect(filter?.source).toBe("auto");
    expect(filter?.paramsJsonSchema).toEqual(
      expect.objectContaining({ type: "object", required: ["criteria"] })
    );
  });

  it("falls back to curated only when the broker catalog throws", async () => {
    const broker = makeFakeBroker({
      listToolkitTools: vi.fn().mockRejectedValue(new Error("composio offline")),
    });
    const actions = await listIntegrationActions("gmail", { broker });
    expect(actions.map((a) => a.name)).toEqual(["send_email", "reply_to_thread"]);
    expect(actions.every((a) => a.source === "curated")).toBe(true);
  });

  it("Gmail send_email descriptor exposes a typed JSON schema", async () => {
    const actions = await listIntegrationActions("gmail", {
      broker: makeFakeBroker(),
    });
    const send = actions.find((a) => a.name === "send_email")!;
    expect(send.source).toBe("curated");
    const schema = send.paramsJsonSchema as {
      required?: string[];
      properties?: Record<string, { type?: string }>;
    };
    expect(schema.required).toEqual(["to", "subject", "body"]);
    expect(schema.properties?.to?.type).toBe("string");
    expect(schema.properties?.cc?.type).toBe("string");
  });
});

describe("executeIntegrationAction", () => {
  const gmailCtx: {
    workspaceId: string;
    userId: string;
    provider: IntegrationProvider;
  } = { workspaceId: "ws-1", userId: "user-1", provider: "gmail" };

  function connectedRow(): Row {
    return {
      id: "row-1",
      workspace_id: gmailCtx.workspaceId,
      user_id: gmailCtx.userId,
      provider: "gmail",
      composio_connection_id: "cc_live",
      status: "connected",
      scopes: [],
      last_used_at: null,
      created_at: "now",
      updated_at: "now",
    };
  }

  it("dispatches send_email to the broker with mapped Composio args", async () => {
    const stub = makeStubDb([connectedRow()]);
    const exec = vi
      .fn()
      .mockResolvedValue({ raw: { id: "msg_a", threadId: "thr_a" } });
    const broker = makeFakeBroker({ executeAction: exec });
    const result = await executeIntegrationAction(
      gmailCtx,
      {
        action: "send_email",
        params: {
          to: "alice@example.com",
          subject: "Hi",
          body: "Hello there",
          cc: "cc@example.com",
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any, broker }
    );
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gmail",
        slug: "GMAIL_SEND_EMAIL",
        brokerConnectionId: "cc_live",
        entityId: "ws-1:user-1",
        arguments: {
          recipient_email: "alice@example.com",
          subject: "Hi",
          body: "Hello there",
          cc: ["cc@example.com"],
        },
      })
    );
    expect(result).toEqual({
      ok: true,
      data: { id: "msg_a", thread_id: "thr_a" },
    });
  });

  it("dispatches reply_to_thread with thread_id + message_body", async () => {
    const stub = makeStubDb([connectedRow()]);
    const exec = vi
      .fn()
      .mockResolvedValue({ raw: { id: "msg_b", threadId: "thr_b" } });
    const broker = makeFakeBroker({ executeAction: exec });
    await executeIntegrationAction(
      gmailCtx,
      {
        action: "reply_to_thread",
        params: { thread_id: "thr_b", to: "alice@example.com", body: "ack" },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any, broker }
    );
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "GMAIL_REPLY_TO_THREAD",
        arguments: {
          thread_id: "thr_b",
          recipient_email: "alice@example.com",
          message_body: "ack",
        },
      })
    );
  });

  it("throws IntegrationActionNotFoundError for an unknown action", async () => {
    const stub = makeStubDb([connectedRow()]);
    await expect(
      executeIntegrationAction(
        gmailCtx,
        { action: "delete_inbox", params: {} },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: stub as any, broker: makeFakeBroker() }
      )
    ).rejects.toBeInstanceOf(IntegrationActionNotFoundError);
  });

  it("throws IntegrationActionValidationError when params don't match the schema", async () => {
    const stub = makeStubDb([connectedRow()]);
    await expect(
      executeIntegrationAction(
        gmailCtx,
        // missing required `body`
        { action: "send_email", params: { to: "x@y.com", subject: "Hi" } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: stub as any, broker: makeFakeBroker() }
      )
    ).rejects.toBeInstanceOf(IntegrationActionValidationError);
  });

  it("throws IntegrationNotConnectedError when there's no live connection", async () => {
    const stub = makeStubDb([]);
    await expect(
      executeIntegrationAction(
        gmailCtx,
        {
          action: "send_email",
          params: { to: "a@b.c", subject: "s", body: "b" },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: stub as any, broker: makeFakeBroker() }
      )
    ).rejects.toBeInstanceOf(IntegrationNotConnectedError);
  });

  it("falls back to the broker catalog and passes params through when the action isn't curated", async () => {
    const stub = makeStubDb([connectedRow()]);
    const exec = vi.fn().mockResolvedValue({
      raw: { id: "filter_123", criteria: { from: "newsletters@x.com" } },
    });
    const broker = makeFakeBroker({
      executeAction: exec,
      listToolkitTools: vi.fn().mockResolvedValue([
        {
          slug: "GMAIL_CREATE_FILTER",
          description: "Create a Gmail filter.",
          inputSchema: { type: "object", properties: {} },
        },
      ]),
    });
    const result = await executeIntegrationAction(
      gmailCtx,
      {
        action: "create_filter",
        params: {
          criteria: { from: "newsletters@x.com" },
          action: { addLabelIds: ["Label_1"] },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any, broker }
    );
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "GMAIL_CREATE_FILTER",
        arguments: {
          criteria: { from: "newsletters@x.com" },
          action: { addLabelIds: ["Label_1"] },
        },
      })
    );
    expect(result).toEqual({
      ok: true,
      data: { id: "filter_123", criteria: { from: "newsletters@x.com" } },
    });
  });
});

describe("listIntegrationObjects", () => {
  it("throws IntegrationReadNotSupportedError for write-only providers", async () => {
    const stub = makeStubDb([]);
    await expect(
      listIntegrationObjects(
        { workspaceId: "ws-1", userId: "user-1", provider: "slack" },
        {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: stub as any, broker: makeFakeBroker() }
      )
    ).rejects.toBeInstanceOf(IntegrationReadNotSupportedError);
  });

  it("throws IntegrationNotConnectedError when no live connection", async () => {
    const stub = makeStubDb([]);
    await expect(
      listIntegrationObjects(
        ctx,
        {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: stub as any, broker: makeFakeBroker() }
      )
    ).rejects.toBeInstanceOf(IntegrationNotConnectedError);
  });

  it("forwards query/cursor/limit to the broker", async () => {
    const stub = makeStubDb([
      {
        id: "row-1",
        workspace_id: ctx.workspaceId,
        user_id: ctx.userId,
        provider: "notion",
        composio_connection_id: "cc_live",
        status: "connected",
        scopes: [],
        last_used_at: null,
        created_at: "now",
        updated_at: "now",
      },
    ]);
    const list = vi.fn().mockResolvedValue({
      objects: [
        { id: "p1", title: "P1", url: null, lastModified: null },
      ],
      nextCursor: "next-1",
    });
    const broker = makeFakeBroker({ listObjects: list });
    const result = await listIntegrationObjects(
      ctx,
      { query: "design system", cursor: "abc", limit: 10 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: stub as any, broker }
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        brokerConnectionId: "cc_live",
        entityId: "ws-1:user-1",
        provider: "notion",
        listInput: expect.objectContaining({
          query: "design system",
          cursor: "abc",
          limit: 10,
        }),
      })
    );
    expect(result).toEqual({
      objects: [{ id: "p1", title: "P1", url: null, lastModified: null }],
      nextCursor: "next-1",
    });
  });
});
