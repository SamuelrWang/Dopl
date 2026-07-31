/**
 * WHAT A CREDENTIAL IS — the classification half of MCP auth, split out of
 * `mcp-oauth.ts` (which sits at the §2 500-line cap and mints/validates rather
 * than describes).
 *
 * WHY IT EXISTS: an agent could not answer "where am I running" because nothing
 * the server knew about its credential ever reached it. `validateAccessToken`
 * read `user_id` and `scopes` and dropped `client_id` / `client_name` on the
 * floor, so the transport boundary could not tell a desktop device token from a
 * claude.ai connector grant, let alone tell the agent.
 *
 * `mcp_tokens.client_name` is denormalized off the mint:
 *   - DEVICE tokens carry the label the minting client asked for. The desktop
 *     app sends `Dopl Desktop CLI (<hostname>)` (`deviceLabel()` in
 *     dopl-desktop-app/main/mcp-config.js) precisely so two machines don't churn
 *     each other's tokens — which makes it the one machine-shaped fact the
 *     server holds about a caller.
 *   - OAUTH-APP tokens carry the `client_name` from Dynamic Client
 *     Registration — whatever the registering MCP app called itself.
 *
 * BOTH ARE UNTRUSTED TEXT. The device label is a free-form string off the mint
 * request body (`z.string().trim().min(1).max(120)`, no charset rule) and the
 * DCR name comes from any client that can register. Rendering either one into
 * agent-facing narration goes through the shared neutralizer.
 *
 * AND IT IS NOT A LOCATION. The label records where the credential was MINTED,
 * never where the session presenting it is RUNNING — a bearer token is copyable
 * by construction (the desktop writes it into a `claude mcp add` entry and into
 * a spawn-config file). Any copy that renders it must say so; see
 * `packages/mcp-server/src/tools/identity.ts`.
 */

/**
 * The reserved first-party client every CLI device token is issued under.
 * The device flow mints a token directly from an authenticated Dopl session
 * (no redirect / auth-code round-trip), so — unlike DCR clients (one per MCP
 * app registration) — a single fixed client row backs them all.
 * `mcp_tokens.client_id` is a NOT NULL FK to `oauth_clients`, so this row
 * must exist before a device token can reference it (see `ensureDeviceClient`).
 */
export const DEVICE_CLIENT_ID = "dopl_client_device_cli";
export const DEVICE_CLIENT_NAME = "Dopl Desktop (device tokens)";

/**
 * How the presented credential was obtained.
 *   - `device` — minted from an interactive Dopl session for a CLI/desktop
 *     listener (`POST /api/auth/mcp-device-token`, cookie-only).
 *   - `oauth-app` — granted to a registered MCP client through the OAuth
 *     authorization-code flow.
 */
export type McpCredentialKind = "device" | "oauth-app";

export interface McpCredential {
  kind: McpCredentialKind;
  /**
   * The credential's own label, VERBATIM and UNTRUSTED — neutralize before
   * rendering. Null when the mint stored none.
   */
  label: string | null;
}

/**
 * Classify a validated `mcp_tokens` row. Keyed on `client_id` alone: the
 * reserved device client id is server-owned (`ensureDeviceClient` upserts it),
 * whereas `client_name` is caller-supplied on both paths and so can never be
 * the discriminator — a DCR app that registered itself as
 * "Dopl Desktop (device tokens)" must still classify as `oauth-app`.
 */
export function describeCredential(
  clientId: string | null | undefined,
  clientName: string | null | undefined,
): McpCredential {
  return {
    kind: clientId === DEVICE_CLIENT_ID ? "device" : "oauth-app",
    label: typeof clientName === "string" && clientName !== "" ? clientName : null,
  };
}
