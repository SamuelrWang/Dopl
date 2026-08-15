/**
 * `POST /api/oauth/token`. Pins the per-IP ceiling and that it runs BEFORE any grant work, while
 * a legitimate authorization_code exchange still returns a token within it.
 * The real `enforceOAuthIpRateLimit` runs; only its RPC and the grant helpers are stubbed.
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

const oauth = vi.hoisted(() => ({
  getClient: vi.fn(),
  consumeAuthCode: vi.fn(),
  issueTokens: vi.fn(),
  rotateRefreshToken: vi.fn(),
}));

vi.mock("@/shared/auth/mcp-oauth", () => oauth);

import { POST } from "./route";

function form(fields: Record<string, string>, headers: Record<string, string> = {}): NextRequest {
  const body = new URLSearchParams(fields).toString();
  return new NextRequest("https://dopl.test/api/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

const CODE_GRANT = {
  grant_type: "authorization_code",
  code: "dopl_ac_x",
  client_id: "dopl_client_1",
  redirect_uri: "https://client.example/cb",
  code_verifier: "verifier",
};

beforeEach(() => {
  vi.clearAllMocks();
  state.within = true;
  state.calls = [];
  oauth.getClient.mockResolvedValue({ client_id: "dopl_client_1", client_name: "App" });
  oauth.consumeAuthCode.mockResolvedValue({ userId: "u1", scopes: ["dopl.read", "dopl.write"] });
  oauth.issueTokens.mockResolvedValue({
    access_token: "dopl_at_new",
    refresh_token: "dopl_rt_new",
    expires_in: 3600,
    scopes: ["dopl.read", "dopl.write"],
  });
});

describe("per-IP rate limit", () => {
  it("keys per IP at the 60/min default", async () => {
    await POST(form(CODE_GRANT, { "x-forwarded-for": "198.51.100.4" }));
    expect(state.calls).toEqual([
      { subject: "oauth-token-ip:198.51.100.4", rpm: 60, endpoint: "POST /api/oauth/token" },
    ]);
  });

  it("over the limit → 429 before any grant work", async () => {
    state.within = false;
    const res = await POST(form(CODE_GRANT, { "x-forwarded-for": "198.51.100.4" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(oauth.getClient).not.toHaveBeenCalled();
    expect(oauth.consumeAuthCode).not.toHaveBeenCalled();
  });
});

describe("legitimate exchange still works within the limit", () => {
  it("authorization_code grant → 200 with an access_token", async () => {
    const res = await POST(form(CODE_GRANT, { "x-forwarded-for": "198.51.100.4" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe("dopl_at_new");
    expect(body.token_type).toBe("Bearer");
    expect(oauth.issueTokens).toHaveBeenCalledTimes(1);
  });
});
