/**
 * **A CURSOR IS NOT TRANSPOSABLE BETWEEN SURFACES** (Review 42, 2026-10-12).
 *
 * ⚠ **THIS FILE EXISTS BECAUSE THE SCOPE BINDING WAS UNASSERTED ON FOUR OF THE
 * FIVE SURFACES THAT ACCEPT A CURSOR.** `cursor-accept.test.ts` proves the codec
 * refuses a cross-scope token, and `service-reads-cursor.test.ts` proves the
 * messages read passes the right one — but nothing drove the other four routes,
 * so nothing noticed WHICH scope each of them chose. A reviewer measured it: the
 * account read handed `{account}` a `{channel,"c-1"}` token and the workspace
 * hold handed `{workspace}` an `{account}` token, and both runs were **GREEN**,
 * with `tsc` at 0. Every scope is the same TypeScript type, so the compiler has
 * nothing to say here; only a route-level case does.
 *
 * ⚠ **AND THE PROPERTY IS ENFORCED BY THE CIPHER, NOT BY A CHECK.** The scope is
 * part of the AAD, so a token minted for one surface cannot be decrypted by
 * another — there is no `if (scope !== …)` anywhere to forget. What a route CAN
 * get wrong is which scope it names, and naming the wrong one does not fail: it
 * silently makes that surface accept cursors minted elsewhere, which is the
 * transposition the integer cursor always allowed and B6 exists to end.
 *
 * ⚠ **THE WHOLE POINT IS THE MATRIX, SO IT IS ONE FILE.** Four co-located route
 * tests would each assert their own surface and none would show that no two
 * surfaces share a key. The mocks are identical for all four anyway — one
 * service module, two auth wrappers.
 *
 * `parseQuery`, the schemas, `acceptChannelCursor`, the codec and
 * `toChannelErrorResponse` all run for REAL. The repositories never do: the
 * assertion is the number the service was handed, and the status on the wire.
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
  // ⚠ The ref the caller used is a SLUG and this resolves it to an id, which is
  // the case that forced the per-channel decode to happen after the lookup.
  resolveReadableChannelId: vi.fn(async () => CHANNEL),
  awaitNewMessages: vi.fn(async () => ({ messages: [] })),
  awaitWorkspaceMessages: vi.fn(async () => ({ messages: [], channelCount: 1 })),
  readAccountMessages: vi.fn(async () => ({ messages: [] })),
  getAccountStatus: vi.fn(async () => ({ channels: [] })),
  listSessionStates: vi.fn(async () => undefined),
}));

import { encodeChannelCursor, type CursorScope } from "@/features/channels/server/cursor-codec";
import {
  awaitNewMessages,
  awaitWorkspaceMessages,
  readAccountMessages,
  getAccountStatus,
} from "@/features/channels/server/service";

import { GET as channelAwait } from "./[channelId]/await/route";
import { GET as workspaceAwait } from "./await/route";
import { GET as accountMessages } from "./account/messages/route";
import { GET as accountStatus } from "./account/status/route";

/**
 * The route context Next.js passes as the second argument. These three routes
 * take no path params, and it is passed anyway because the WRAPPER's type
 * requires it — vitest is happy without it, `tsc` is not. (It was not, twice in
 * this branch: a suite can be green while the typecheck is red, which is why the
 * gate line is read before every commit.)
 */
const NO_PARAMS = { params: Promise.resolve({}) } as never;

/** The scope each surface is supposed to name. */
const CHANNEL_SCOPE: CursorScope = { kind: "channel", channelId: CHANNEL };
const WORKSPACE_SCOPE: CursorScope = { kind: "workspace", workspaceId: WORKSPACE };
const ACCOUNT_SCOPE: CursorScope = { kind: "account" };

type Surface = {
  name: string;
  /** The scope a token must be minted for to be accepted here. */
  own: CursorScope;
  /**
   * EVERY other scope, each of which must be refused here.
   *
   * ⚠ **A LIST AND NOT ONE SCOPE, BECAUSE ONE WAS NOT ENOUGH TO CATCH THE BUG
   * THIS FILE IS FOR.** With a single foreign scope, mutating the workspace hold
   * to name `{account}` reddened only its own-token case: the one foreign token
   * it tried was a channel token, which `{account}` refuses too, so that case
   * passed for the wrong reason. The surface must refuse all three, which is
   * also the actual claim — no two surfaces share a key.
   */
  foreign: CursorScope[];
  call: (query: string) => Promise<Response>;
  /** The `since` the service was handed. */
  since: () => unknown;
};

/** Every scope but the surface's own. Account read and status share one. */
function others(own: CursorScope): CursorScope[] {
  return [CHANNEL_SCOPE, WORKSPACE_SCOPE, ACCOUNT_SCOPE].filter(
    (s) => s.kind !== own.kind,
  );
}

const SURFACES: Surface[] = [
  {
    name: "per-channel await",
    own: CHANNEL_SCOPE,
    // ⚠ The workspace token is the sharp one here: the per-channel hold and the
    // workspace hold are both reached by the same credential in the same
    // container, so if either named the other's scope nothing else would notice.
    foreign: others(CHANNEL_SCOPE),
    call: (query) =>
      channelAwait(
        new NextRequest(`http://x/api/channels/general/await${query}`),
        { params: Promise.resolve({ channelId: "general" }) } as never,
      ),
    since: () => vi.mocked(awaitNewMessages).mock.calls[0]?.[2]?.since,
  },
  {
    name: "workspace hold",
    own: WORKSPACE_SCOPE,
    foreign: others(WORKSPACE_SCOPE),
    call: (query) =>
      workspaceAwait(
        new NextRequest(`http://x/api/channels/await${query}`),
        NO_PARAMS,
      ),
    since: () => vi.mocked(awaitWorkspaceMessages).mock.calls[0]?.[1]?.since,
  },
  {
    name: "account read",
    own: ACCOUNT_SCOPE,
    foreign: others(ACCOUNT_SCOPE),
    call: (query) =>
      accountMessages(
        new NextRequest(`http://x/api/channels/account/messages${query}`),
        NO_PARAMS,
      ),
    since: () => vi.mocked(readAccountMessages).mock.calls[0]?.[1]?.since,
  },
  {
    name: "account status",
    own: ACCOUNT_SCOPE,
    // ⚠ Status and the account read share a scope ON PURPOSE — one cursor spans
    // both — so the foreign set here is the two narrower scopes, and `{account}`
    // is correctly absent from it.
    foreign: others(ACCOUNT_SCOPE),
    call: (query) =>
      accountStatus(
        new NextRequest(`http://x/api/channels/account/status${query}`),
        NO_PARAMS,
      ),
    since: () => vi.mocked(getAccountStatus).mock.calls[0]?.[1]?.since,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DOPL_CURSOR_KEY", randomBytes(32).toString("base64"));
  // The hold routes log a diag line from a `finally`; silence it.
  vi.stubEnv("DOPL_AWAIT_DIAG", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(SURFACES)("$name", (surface) => {
  it("🔒 a token minted for THIS surface decodes, and the service sees a number", async () => {
    const token = encodeChannelCursor(4461, surface.own, USER);
    const res = await surface.call(`?since=${token}`);
    expect(res.status).toBe(200);
    expect(surface.since()).toBe(4461);
  });

  it("🔒 a token minted for ANY other scope is refused — 400, not a silent wrong page", async () => {
    // ⚠ The failure this forbids is not an error, it is an ANSWER: a surface
    // naming the wrong scope decodes the other surface's cursor and reads from
    // whatever seq it carried, which is a plausible page from the wrong place.
    for (const scope of surface.foreign) {
      vi.clearAllMocks();
      const token = encodeChannelCursor(4461, scope, USER);
      const res = await surface.call(`?since=${token}`);
      expect(res.status, scope.kind).toBe(400);
      expect(JSON.stringify(await res.json()), scope.kind).toContain(
        "CHANNEL_CURSOR_UNDECODABLE",
      );
    }
  });

  it("🔒 and the refusal happens BEFORE the read runs", async () => {
    for (const scope of surface.foreign) {
      vi.clearAllMocks();
      const token = encodeChannelCursor(4461, scope, USER);
      await surface.call(`?since=${token}`);
      expect(surface.since(), scope.kind).toBeUndefined();
    }
  });

  it("a legacy integer still reaches this surface unchanged", async () => {
    // Every client sends one today; this is the compatibility half, and it is
    // per-surface because each one decodes separately.
    const res = await surface.call("?since=4461");
    expect(res.status).toBe(200);
    expect(surface.since()).toBe(4461);
  });

  it("another reader's token is refused here too", async () => {
    // The reader is AAD as well, so a cursor is not portable between accounts
    // even on the surface it was minted for.
    const token = encodeChannelCursor(4461, surface.own, "22222222-e29b-41d4-a716-446655440000");
    expect((await surface.call(`?since=${token}`)).status).toBe(400);
  });
});

/**
 * ⚠ **THE SCOPES-DIFFER MATRIX ABOVE CANNOT EXPRESS THIS ONE**, and it is the
 * likeliest transposition of all: two channels, one workspace, one credential,
 * one agent holding both. `others()` varies the scope KIND, so for the
 * per-channel hold it never tries a second channel.
 */
describe("per-channel await, between two channels", () => {
  const otherChannel: CursorScope = { kind: "channel", channelId: "chan-2" };

  function hold(query: string) {
    return channelAwait(
      new NextRequest(`http://x/api/channels/general/await${query}`),
      { params: Promise.resolve({ channelId: "general" }) } as never,
    );
  }

  it("🔒 a token for a DIFFERENT channel is refused, same workspace and same reader", async () => {
    const token = encodeChannelCursor(4461, otherChannel, USER);
    const res = await hold(`?since=${token}`);
    expect(res.status).toBe(400);
    expect(vi.mocked(awaitNewMessages)).not.toHaveBeenCalled();
  });

  it("🔒 while the resolved channel's own token decodes — the ref was a SLUG", async () => {
    // `resolveReadableChannelId` turns `"general"` into `chan-1`, and the token
    // is bound to that id. This is why the decode had to move INSIDE the handler,
    // after the lookup: binding to the spelling the caller used would make a
    // slug-addressed hold undecodable.
    const token = encodeChannelCursor(4461, CHANNEL_SCOPE, USER);
    expect((await hold(`?since=${token}`)).status).toBe(200);
    expect(vi.mocked(awaitNewMessages).mock.calls[0]?.[2]?.since).toBe(4461);
  });
});
