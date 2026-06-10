import "server-only";
import { touchMcpStatus, checkAndRecordRateLimitSubject } from "./mcp-session";
import { isOAuthAccessToken, validateAccessToken } from "./mcp-oauth";

// Per-token request ceiling for OAuth callers at the /api/mcp boundary.
// Generous by default — agents are bursty — but caps runaway abuse. The
// loopback /api/* calls skip rate limiting to avoid double-counting, so the
// ceiling is enforced here. Override via env.
const OAUTH_RPM = Number(process.env.MCP_OAUTH_RATE_LIMIT_RPM) || 600;

/**
 * Authentication for the remote MCP transport boundary (`/api/mcp`).
 *
 * Accepts an OAuth access token (the "Connect → log in" flow) via
 * `mcp-oauth.ts`. This is the only credential — there is no API-key path.
 *
 * This is intentionally distinct from `withMcpAccess` / `withWorkspaceAuth`:
 * those run the heavy gating (paywall, rate limit, per-resource
 * `agent_write_enabled`) and fire on every downstream `/api/*` call the
 * in-app MCP server makes via the loopback `DoplClient`. Here we only:
 *   1. validate the credential cheaply for an early, spec-correct 401, and
 *   2. light up the "MCP connected" indicator.
 * The credential is then forwarded to the loopback client so the real
 * gating happens exactly once per tool call, in one place.
 */

export interface McpAuthContext {
  /** Raw credential to forward to the loopback DoplClient (Authorization: Bearer). */
  credential: string;
  userId: string;
  /**
   * Workspace this session is locked to, else null. Always null for OAuth
   * callers (they target any workspace via `x-workspace-id` / `set_workspace`).
   */
  apiKeyWorkspaceId: string | null;
  /**
   * OAuth scopes for this session (e.g. ["dopl.read","dopl.write"]). Passed
   * into bootServer to gate write/admin tool registration.
   */
  scopes?: string[];
}

export type McpAuthResult =
  | { ok: true; auth: McpAuthContext }
  | { ok: false; response: Response };

export async function authenticateMcpRequest(
  request: Request,
): Promise<McpAuthResult> {
  const header = request.headers.get("authorization");
  const key = header?.replace(/^Bearer\s+/i, "").trim();

  // OAuth access token (remote "Connect → log in" flow) — the only credential.
  if (key && isOAuthAccessToken(key)) {
    const tok = await validateAccessToken(key);
    if (tok) {
      const within = await checkAndRecordRateLimitSubject(
        `mcp:${tok.tokenId}`,
        OAUTH_RPM,
        "POST /api/mcp",
      );
      if (!within) return { ok: false, response: rateLimited() };
      // Debounced internally — flips the settings "MCP connected" card.
      touchMcpStatus(tok.userId);
      return {
        ok: true,
        auth: {
          credential: key,
          userId: tok.userId,
          apiKeyWorkspaceId: null,
          scopes: tok.scopes,
        },
      };
    }
  }

  return { ok: false, response: unauthorized(request) };
}

/**
 * RFC 9728 / MCP-auth-spec 401: a `WWW-Authenticate` challenge that points
 * MCP clients at our protected-resource metadata so they can discover how to
 * authenticate (Stage 3 fills the metadata with the OAuth authorization
 * server; in Stage 2 it advertises bearer).
 */
function rateLimited(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Rate limit exceeded. Try again shortly." },
    }),
    {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    },
  );
}

function unauthorized(request: Request): Response {
  const origin = new URL(request.url).origin;
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource`;
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32001,
        message: "Unauthorized: missing or invalid credentials.",
      },
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"`,
      },
    },
  );
}
