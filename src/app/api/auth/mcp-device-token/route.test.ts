/**
 * The device-token route's AUTH MATRIX through the REAL `withUserAuth`.
 * ⚠ A bearer must not operate the controls that govern bearers: via POST an agent mints itself a
 * fresh 90-day credential; via DELETE it revokes its siblings' credential and deletes the row
 * whose `last_used_at` records that it ran. Both methods are `sessionOnly`, pinned per-method.
 * Only the token + DB layers are mocked, so the discriminator exercised is the real one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  token: null as { userId: string; scopes: string[]; tokenId: string } | null,
  sessionUser: null as { id: string } | null,
}));

vi.mock("@/shared/auth/mcp-session", () => ({
  touchMcpStatus: vi.fn(),
  // ⚠ The OAuth branch rate-limits BEFORE the sessionOnly gate; admit everything so the refusal
  // under test is the caller-type one, not the ceiling.
  checkAndRecordRateLimitSubject: vi.fn(async () => true),
}));
vi.mock("@/features/analytics/server/mcp-events", () => ({ logMcpEvent: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      // ⚠ The session branch resolves the caller from LOCALLY verified claims, not `getUser()`;
      // `getUser` is on the stub only for the auth-js legacy/HS256 fallback.
      getClaims: async () => ({
        data: state.sessionUser
          ? {
              claims: { sub: state.sessionUser.id },
              header: { alg: "ES256", typ: "JWT", kid: "kid-1" },
              signature: new Uint8Array(64),
            }
          : null,
        error: null,
      }),
      getUser: async () => ({ data: { user: state.sessionUser } }),
    },
  }),
}));
vi.mock("@/shared/auth/mcp-oauth", () => ({
  validateAccessToken: vi.fn(async () => state.token),
  // ⚠ Discriminates bearer KINDS before `validateAccessToken` — mirror the real prefix check or
  // every bearer-carrying case throws inside the wrapper.
  isOAuthAccessToken: (token: string) => token.startsWith("dopl_at_"),
  issueDeviceToken: vi.fn(async () => ({
    token: "dopl_at_minted",
    expiresAt: "2026-10-29T00:00:00.000Z",
  })),
  revokeDeviceTokens: vi.fn(async () => 1),
}));

import { POST, DELETE } from "./route";
import { issueDeviceToken, revokeDeviceTokens } from "@/shared/auth/mcp-oauth";

const URL_ = "http://localhost/api/auth/mcp-device-token";

/** OAuth bearer → token branch. */
function bearerReq(method: string, body?: unknown): NextRequest {
  return new NextRequest(URL_, {
    method,
    headers: { authorization: "Bearer dopl_at_agent", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** No Authorization header → session branch. */
function sessionReq(method: string, body?: unknown): NextRequest {
  return new NextRequest(URL_, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const WRITE_TOKEN = {
  userId: "agent-user",
  scopes: ["dopl.read", "dopl.write"],
  tokenId: "tok-agent",
};

beforeEach(() => {
  vi.clearAllMocks();
  state.token = null;
  state.sessionUser = null;
});

// ── The matrix ─────────────────────────────────────────────────────────────

describe("DELETE (revoke) — caller-type gate", () => {
  it("a cookie SESSION caller is admitted and the revoke runs for THAT user", async () => {
    state.sessionUser = { id: "user-9" };
    const res = await DELETE(sessionReq("DELETE", { label: "Dopl Desktop CLI (mbp)" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: 1 });
    expect(revokeDeviceTokens).toHaveBeenCalledWith({
      // ⚠ User id comes from the SESSION, never the body.
      userId: "user-9",
      label: "Dopl Desktop CLI (mbp)",
      tokenId: undefined,
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a FULL-WRITE agent bearer is REFUSED 403 SESSION_REQUIRED, handler never runs", async () => {
    state.token = WRITE_TOKEN;
    const res = await DELETE(bearerReq("DELETE", { label: "Dopl Desktop CLI (mbp)" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SESSION_REQUIRED");
    expect(revokeDeviceTokens).not.toHaveBeenCalled();
  });

  it("a read-only bearer is refused too — the gate is caller TYPE, not scope", async () => {
    state.token = { userId: "agent-user", scopes: ["dopl.read"], tokenId: "tok-ro" };
    const res = await DELETE(bearerReq("DELETE", { label: "L" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SESSION_REQUIRED");
    expect(revokeDeviceTokens).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller gets 401 and revokes nothing", async () => {
    const res = await DELETE(sessionReq("DELETE", { label: "L" }));
    expect(res.status).toBe(401);
    expect(revokeDeviceTokens).not.toHaveBeenCalled();
  });

  it("a bogus bearer (no session either) is 401, not a fall-through to the cookie branch", async () => {
    state.token = null;
    state.sessionUser = { id: "user-9" }; // a live session exists…
    const res = await DELETE(bearerReq("DELETE", { label: "L" })); // …but a header was sent
    expect(res.status).toBe(401);
    expect(revokeDeviceTokens).not.toHaveBeenCalled();
  });
});

describe("POST (mint) — the same gate, pinned alongside it", () => {
  it("a cookie session mints; an agent bearer is refused 403", async () => {
    state.sessionUser = { id: "user-9" };
    expect((await POST(sessionReq("POST", { label: "L" }))).status).toBe(200);
    expect(issueDeviceToken).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    state.sessionUser = null;
    state.token = WRITE_TOKEN;
    const res = await POST(bearerReq("POST", { label: "L" }));
    expect(res.status).toBe(403);
    expect(issueDeviceToken).not.toHaveBeenCalled();
  });
});

// ── Selector handling ──────────────────────────────────────────────────────

describe("DELETE — selectors", () => {
  beforeEach(() => {
    state.sessionUser = { id: "user-9" };
  });

  it("revokes by token id", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const res = await DELETE(sessionReq("DELETE", { tokenId: id }));
    expect(res.status).toBe(200);
    expect(revokeDeviceTokens).toHaveBeenCalledWith({
      userId: "user-9",
      label: undefined,
      tokenId: id,
    });
  });

  it("an EMPTY body is 400, never an accidental revoke-everything", async () => {
    for (const req of [sessionReq("DELETE"), sessionReq("DELETE", {})]) {
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    }
    expect(revokeDeviceTokens).not.toHaveBeenCalled();
  });

  it("a malformed selector is 400 (non-uuid id, empty label)", async () => {
    expect((await DELETE(sessionReq("DELETE", { tokenId: "not-a-uuid" }))).status).toBe(400);
    expect((await DELETE(sessionReq("DELETE", { label: "   " }))).status).toBe(400);
    expect(revokeDeviceTokens).not.toHaveBeenCalled();
  });

  it("IDEMPOTENT: revoking something already gone is a quiet 200 with revoked: 0", async () => {
    vi.mocked(revokeDeviceTokens).mockResolvedValueOnce(0);
    const res = await DELETE(sessionReq("DELETE", { label: "already-gone" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: 0 });
  });
});
