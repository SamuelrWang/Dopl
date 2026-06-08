import "server-only";
import { validateApiKey, touchMcpStatus } from "./api-keys";
import { isOAuthAccessToken, validateAccessToken } from "./mcp-oauth";

/**
 * Authentication for the remote MCP transport boundary (`/api/mcp`).
 *
 * Stage 2: bearer API key (`sk-dopl-...`). Stage 3 (OAuth) extends
 * `authenticateMcpRequest` to ALSO accept OAuth access tokens (via
 * `mcp-oauth.ts`) without changing the route.
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
  /** Present for API-key callers; absent for OAuth-token callers. */
  apiKeyId?: string;
  /** Workspace the key is locked to (workspace-scoped key), else null. */
  apiKeyWorkspaceId: string | null;
  /**
   * OAuth scopes for this session (e.g. ["dopl.read","dopl.write"]). Undefined
   * for API-key callers ⇒ full access. Passed into bootServer to gate
   * write/admin tool registration.
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

  if (key) {
    // OAuth access token (remote "Connect → log in" flow).
    if (isOAuthAccessToken(key)) {
      const tok = await validateAccessToken(key);
      if (tok) {
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
    } else {
      // Bearer API key (`sk-dopl-...`). Service keys (user_id null) can't map
      // to an MCP user session.
      const record = await validateApiKey(key);
      if (record?.user_id) {
        // Debounced internally — flips the settings "MCP connected" card.
        touchMcpStatus(record.user_id);
        return {
          ok: true,
          auth: {
            credential: key,
            userId: record.user_id,
            apiKeyId: record.id,
            apiKeyWorkspaceId: record.workspace_id,
          },
        };
      }
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
