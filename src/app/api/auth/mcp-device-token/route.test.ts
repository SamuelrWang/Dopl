/**
 * F-085 — the device-token route's AUTH MATRIX, exercised through the REAL
 * `withUserAuth`.
 *
 * THE SECURITY PROPERTY THIS FILE EXISTS FOR: a bearer must not be able to
 * operate the controls that govern bearers. The desktop hands a 90-day
 * dopl.read+dopl.write device token to every spawned agent, and that agent's
 * whole job is to process an untrusted teammate's message. If it could reach
 * POST it would mint itself a fresh 90-day credential; if it could reach DELETE
 * it would revoke the credential its siblings (or the operator's other
 * machines) depend on, and could delete the very row whose `last_used_at`
 * records that it ran. Both methods are therefore `sessionOnly` — cookie
 * callers only — and that is pinned here per-method, not inferred from the
 * option object.
 *
 * Only the token layer and the DB layer are mocked; the wrapper under test is
 * the shipping one, so the discriminator being exercised is the real one
 * (an Authorization header selects the token branch, its absence the session
 * branch).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  token: null as { userId: string; scopes: string[]; tokenId: string } | null,
  sessionUser: null as { id: string } | null,
}));

vi.mock("@/shared/auth/mcp-session", () => ({ touchMcpStatus: vi.fn() }));
vi.mock("@/features/analytics/server/mcp-events", () => ({ logMcpEvent: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      // Q11: the session branch of `withUserAuth` resolves the caller from
      // LOCALLY verified claims, not a network `getUser()`. `getUser` stays on
      // the stub for the auth-js legacy/HS256 fallback path only.
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
  issueDeviceToken: vi.fn(async () => ({
    token: "dopl_at_minted",
    expiresAt: "2026-10-29T00:00:00.000Z",
  })),
  revokeDeviceTokens: vi.fn(async () => 1),
}));

import { POST, DELETE } from "./route";
import { issueDeviceToken, revokeDeviceTokens } from "@/shared/auth/mcp-oauth";

const URL_ = "http://localhost/api/auth/mcp-device-token";

/** Request carrying an OAuth bearer (routes to the token branch). */
function bearerReq(method: string, body?: unknown): NextRequest {
  return new NextRequest(URL_, {
    method,
    headers: { authorization: "Bearer dopl_at_agent", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Request with no Authorization header (routes to the session branch). */
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
      // The user id comes from the SESSION, never from the body — a caller
      // cannot name someone else's account.
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
