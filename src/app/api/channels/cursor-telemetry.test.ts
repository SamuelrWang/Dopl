/**
 * **B6-4: EVERY ACCEPT SURFACE COUNTS UNDER ITS OWN NAME** (2026-10-13).
 *
 * The sunset question is per surface ("who still sends integers, and where"),
 * and the surface name is the one thing `acceptChannelCursor` cannot work out
 * for itself: two routes share the account scope, two more share the channel
 * scope. So each route names itself, and this matrix drives every route with
 * each form, with and without `X-Dopl-Cursor: opaque-1`, and asserts the exact
 * line. A route that names the wrong surface, or reads the header wrong, goes
 * red here.
 *
 * `parseQuery`, the schemas, `acceptChannelCursor`, the codec and the counter
 * run for REAL; only the service is mocked. The messages read decodes inside
 * the service, so for it the assertion is the capability the route passes on
 * (the service half is in `service-reads-cursor.test.ts`).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

const USER = "11111111-e29b-41d4-a716-446655440000";
const WORKSPACE = "ws-1";
const CHANNEL = "chan-1";

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: NextRequest, ctx: unknown) => Promise<Response>) =>
    (req: NextRequest) =>
      handler(req, {
        userId: USER,
        workspaceId: WORKSPACE,
        role: "member",
        params: { channelId: "general" },
        credentialSubjectUserId: USER,
      }),
}));

vi.mock("@/shared/auth/with-auth", () => ({
  withUserAuth:
    (handler: (req: NextRequest, ctx: unknown) => Promise<Response>) =>
    (req: NextRequest) =>
      handler(req, {
        userId: USER,
        apiKeyWorkspaceId: null,
        credentialSubjectUserId: USER,
      }),
}));

vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: (auth: { userId: string; workspaceId: string }) => ({
    userId: auth.userId,
    workspaceId: auth.workspaceId,
    credentialSubjectUserId: auth.userId,
    source: "user",
    role: "member",
  }),
  resolveReadableChannelId: vi.fn(async () => CHANNEL),
  awaitNewMessages: vi.fn(async () => ({ messages: [] })),
  awaitWorkspaceMessages: vi.fn(async () => ({ messages: [], channelCount: 1 })),
  readAccountMessages: vi.fn(async () => ({ messages: [] })),
  getAccountStatus: vi.fn(async () => ({ channels: [] })),
  listSessionStates: vi.fn(async () => undefined),
  readTranscript: vi.fn(async () => ({ messages: [], entries: null, hasMore: false })),
  postMessage: vi.fn(),
}));

import { encodeChannelCursor, type CursorScope } from "@/features/channels/server/cursor-codec";
import { readTranscript } from "@/features/channels/server/service";

import { GET as channelAwait } from "./[channelId]/await/route";
import { GET as workspaceAwait } from "./await/route";
import { GET as accountMessages } from "./account/messages/route";
import { GET as accountStatus } from "./account/status/route";
import { GET as channelMessages } from "./[channelId]/messages/route";

const NO_PARAMS = { params: Promise.resolve({}) } as never;
const CHANNEL_PARAMS = { params: Promise.resolve({ channelId: "general" }) } as never;

type Route = {
  surface: string;
  scope: CursorScope;
  /** The account read REQUIRES `since`: absent is a 400 at the schema, before any accept. */
  sinceRequired?: boolean;
  call: (query: string, headers: HeadersInit) => Promise<Response>;
};

const ROUTES: Route[] = [
  {
    surface: "channel-await",
    scope: { kind: "channel", channelId: CHANNEL },
    call: (q, h) =>
      channelAwait(new NextRequest(`http://x/api/channels/general/await${q}`, { headers: h }), CHANNEL_PARAMS),
  },
  {
    surface: "workspace-await",
    scope: { kind: "workspace", workspaceId: WORKSPACE },
    call: (q, h) =>
      workspaceAwait(new NextRequest(`http://x/api/channels/await${q}`, { headers: h }), NO_PARAMS),
  },
  {
    surface: "account-messages",
    scope: { kind: "account" },
    sinceRequired: true,
    call: (q, h) =>
      accountMessages(new NextRequest(`http://x/api/channels/account/messages${q}`, { headers: h }), NO_PARAMS),
  },
  {
    surface: "account-status",
    scope: { kind: "account" },
    call: (q, h) =>
      accountStatus(new NextRequest(`http://x/api/channels/account/status${q}`, { headers: h }), NO_PARAMS),
  },
];

const ADVERTISED = { "X-Dopl-Cursor": "opaque-1" };

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DOPL_CURSOR_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("DOPL_AWAIT_DIAG", "0");
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  vi.unstubAllEnvs();
});

function lines(): string[] {
  return log.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((l: string) => l.startsWith("[cursor-form]"));
}

describe.each(ROUTES)("$surface", (route) => {
  const cases = () => [
    { query: "?since=4461", form: "integer" },
    { query: `?since=${encodeChannelCursor(4461, route.scope, USER)}`, form: "token" },
    ...(route.sinceRequired ? [] : [{ query: "", form: "absent" }]),
  ];

  it("🔒 logs its own surface name and the form, advertised=yes with the header", async () => {
    for (const c of cases()) {
      log.mockClear();
      const res = await route.call(c.query, ADVERTISED);
      expect(res.status, c.form).toBe(200);
      expect(lines(), c.form).toEqual([
        `[cursor-form] surface=${route.surface} form=${c.form} advertised=yes`,
      ]);
    }
  });

  it.runIf(route.sinceRequired)("absent is refused by the schema and never counted", async () => {
    expect((await route.call("", ADVERTISED)).status).toBe(400);
    expect(lines()).toEqual([]);
  });

  it("🔒 advertised=no without the header, or with a different value", async () => {
    for (const headers of [{}, { "X-Dopl-Cursor": "opaque-2" }] as HeadersInit[]) {
      log.mockClear();
      await route.call("?since=4461", headers);
      expect(lines()).toEqual([
        `[cursor-form] surface=${route.surface} form=integer advertised=no`,
      ]);
    }
  });
});

describe("messages-read (decodes inside the service)", () => {
  function read(headers: HeadersInit) {
    return channelMessages(
      new NextRequest("http://x/api/channels/general/messages?since=4461", { headers }),
      CHANNEL_PARAMS,
    );
  }

  it("🔒 passes advertised=true to the service when the header is sent", async () => {
    expect((await read(ADVERTISED)).status).toBe(200);
    expect(vi.mocked(readTranscript).mock.calls[0]?.[3]).toBe(true);
  });

  it("🔒 passes advertised=false, not undefined, when it is absent", async () => {
    await read({});
    expect(vi.mocked(readTranscript).mock.calls[0]?.[3]).toBe(false);
  });
});
