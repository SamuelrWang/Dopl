import "server-only";
import { touchMcpStatus, checkAndRecordRateLimitSubject } from "./mcp-session";
import { isOAuthAccessToken, validateAccessToken } from "./mcp-oauth";
import type { McpCredential } from "./mcp-credential";

// Per-token ceiling for OAuth callers at the /api/mcp boundary.
// ⚠ UNIFIED BUDGET: `withUserAuth`'s OAuth-bearer branch runs a matching limiter
// on the same `mcp:<tokenId>` subject, and both doors read this SAME env var —
// one shared budget across the transport and direct REST, never two.
const OAUTH_RPM = Number(process.env.MCP_OAUTH_RATE_LIMIT_RPM) || 600;

/**
 * Auth for the remote MCP transport boundary (`/api/mcp`). OAuth access token
 * only — there is no API-key path.
 *
 * ⚠ Deliberately distinct from `withMcpAccess` / `withWorkspaceAuth`, which run
 * the heavy gating on every downstream loopback `/api/*` call. Here only:
 *   1. cheap credential validation for an early, spec-correct 401;
 *   2. lighting the "MCP connected" indicator.
 * The credential is forwarded to the loopback client so real gating happens
 * exactly once per tool call, in one place.
 */

export interface McpAuthContext {
  /** Raw credential to forward to the loopback DoplClient (Authorization: Bearer). */
  credential: string;
  userId: string;
  /** AXIS 1 — WHICH CONTAINER this session is fenced to. Always null for OAuth
   *  callers — they target any workspace via `x-workspace-id` or the per-call
   *  `workspace=`. ⚠ The SUBJECT axis is deliberately absent from this context;
   *  see the note at its assignment below. */
  apiKeyWorkspaceId: string | null;
  /** OAuth scopes; passed into bootServer to gate write/admin tool
   *  registration. */
  scopes?: string[];
  /** WHICH credential answered, for the agent's benefit. ⚠ NOT an authorization
   *  input — nothing here may gate anything. */
  credential_info: McpCredential;
  /**
   * 🔒 THE OPAQUE KEY ONE MCP CONNECTION IS IDENTIFIED BY, and its ONLY consumer
   * is the session workspace PIN (`@dopl/mcp-server › session-pin.ts`, T41).
   *
   * ⚠ **IT IS A MAP KEY AND NOTHING ELSE — never rendered, never logged, never
   * compared to anything but itself, and it GATES NOTHING.** A pin only ever
   * picks among memberships the boot directory already proved, so the worst a
   * wrong key can do is lose a default and fall back to the pre-existing
   * `WORKSPACE_REQUIRED` refusal.
   *
   * ⚠ **THE TOKEN ROW ID IS THE RIGHT GRANULARITY BECAUSE THE TRANSPORT IS
   * STATELESS.** `/api/mcp` runs `sessionIdGenerator: undefined` and `bootServer`
   * boots per HTTP REQUEST, so there is no protocol session id to key on; one
   * OAuth credential is one client install, which is what an operator means by
   * "this connection". It is already the rate-limit subject
   * (`mcp:<tokenId>`), so it is not a new identifier — it is the one this
   * boundary already treats as the caller.
   */
  tokenId: string;
}

export type McpAuthResult =
  | { ok: true; auth: McpAuthContext }
  | { ok: false; response: Response };

export async function authenticateMcpRequest(
  request: Request,
): Promise<McpAuthResult> {
  const header = request.headers.get("authorization");
  const key = header?.replace(/^Bearer\s+/i, "").trim();

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
          // 🔒 THE CONTAINER LOCK, and this line was a hardcoded `null` until
          // 2026-08-26 because no credential could carry one (plan §4.4 B1;
          // `with-auth.ts`'s docblock has the history). It must move with its
          // sibling: the two auth families reach the same services, and a lock
          // honoured on one path and dropped on the other is a fence with a
          // door in it that nothing in either file would mention.
          apiKeyWorkspaceId: tok.containerId,
          // ⚠ THE SUBJECT AXIS IS DELIBERATELY NOT CARRIED HERE, and this is
          // the one place the two families legitimately differ (2026-08-27,
          // F-336). It is an AUDIENCE input and this boundary builds no feature
          // context: it forwards the raw credential to the loopback DoplClient,
          // which re-authenticates through `with-auth.ts` and reads the axis
          // there, once. What this file uses the CONTAINER axis for is the
          // workspace pin (`mcp-transport-pin.ts` / `bootServer`), which the
          // audience never touches. Adding it here would be a second copy of an
          // authorization input with no reader.
          scopes: tok.scopes,
          credential_info: tok.credential,
          tokenId: tok.tokenId,
        },
      };
    }
  }

  return { ok: false, response: unauthorized(request) };
}

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

/** RFC 9728 / MCP-auth-spec 401: a `WWW-Authenticate` challenge pointing MCP
 *  clients at our protected-resource metadata. */
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
