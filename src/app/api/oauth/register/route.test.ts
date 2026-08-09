/**
 * `POST /api/oauth/register` — RFC 7591 dynamic client registration.
 *
 * This endpoint is UNAUTHENTICATED by spec (public MCP clients self-register)
 * and INSERTs an `oauth_clients` row per call, so it was an unbounded
 * table-growth primitive. These tests pin the per-IP ceiling that now bounds it
 * WITHOUT closing the legitimate onboarding path: a real registration still
 * returns its `client_id`, and the limit is checked before any row is written.
 *
 * The real `enforceOAuthIpRateLimit` runs (only its underlying
 * `check_and_record_rate_limit_subject` RPC is stubbed), so IP extraction and
 * the 429 shape are the shipping ones.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  within: true as boolean,
  calls: [] as { subject: string; rpm: number; endpoint: string }[],
}));

vi.mock("@/shared/auth/mcp-session", () => ({
  checkAndRecordRateLimitSubject: vi.fn(
    async (subject: string, rpm: number, endpoint: string) => {
      state.calls.push({ subject, rpm, endpoint });
      return state.within;
    }
  ),
}));

vi.mock("@/shared/auth/mcp-oauth", () => ({
  registerClient: vi.fn(async (input: { client_name: string | null; redirect_uris: string[] }) => ({
    client_id: "dopl_client_new",
    client_name: input.client_name,
    redirect_uris: input.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
  })),
}));

import { POST } from "./route";
import { registerClient } from "@/shared/auth/mcp-oauth";

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://dopl.test/api/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const VALID = { redirect_uris: ["https://client.example/callback"], client_name: "Some MCP App" };

beforeEach(() => {
  vi.clearAllMocks();
  state.within = true;
  state.calls = [];
});

describe("per-IP rate limit", () => {
  it("keys on the first X-Forwarded-For hop at the 20/min default", async () => {
    await POST(req(VALID, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
    expect(state.calls).toEqual([
      { subject: "oauth-register-ip:203.0.113.7", rpm: 20, endpoint: "POST /api/oauth/register" },
    ]);
  });

  it("over the limit → 429 and NO client is registered (limit runs first)", async () => {
    state.within = false;
    const res = await POST(req(VALID, { "x-forwarded-for": "203.0.113.7" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(registerClient).not.toHaveBeenCalled();
  });

  it("a header-less caller shares the 'unknown' bucket (fails toward limiting)", async () => {
    await POST(req(VALID));
    expect(state.calls[0].subject).toBe("oauth-register-ip:unknown");
  });
});

describe("RFC 7591 onboarding path stays open", () => {
  it("within the limit → 201 with a client_id (registration succeeds)", async () => {
    const res = await POST(req(VALID, { "x-forwarded-for": "203.0.113.7" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.client_id).toBe("dopl_client_new");
    expect(body.redirect_uris).toEqual(VALID.redirect_uris);
    expect(registerClient).toHaveBeenCalledTimes(1);
  });

  it("still validates input after the limit passes (missing redirect_uris → 400)", async () => {
    const res = await POST(req({ client_name: "x" }, { "x-forwarded-for": "203.0.113.7" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_redirect_uri");
    // The limiter was consulted (and passed) before validation ran.
    expect(state.calls).toHaveLength(1);
    expect(registerClient).not.toHaveBeenCalled();
  });
});
