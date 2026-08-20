/**
 * Classification half of MCP auth (split out of `mcp-oauth.ts`, which mints and
 * validates rather than describes). Lets the transport boundary tell a desktop
 * device token from a claude.ai connector grant.
 *
 * `mcp_tokens.client_name` is denormalized off the mint:
 *   - DEVICE tokens carry the minting client's label; the desktop sends
 *     `Dopl Desktop CLI (<hostname>)` so two machines don't churn each other's
 *     tokens — the one machine-shaped fact the server holds about a caller.
 *   - OAUTH-APP tokens carry the Dynamic Client Registration `client_name`.
 *
 * ⚠ BOTH ARE UNTRUSTED TEXT — free-form off the mint body / any registering
 * client. Rendering either into agent-facing narration goes through the shared
 * neutralizer.
 *
 * ⚠ NOT A LOCATION. The label records where the credential was MINTED, never
 * where the presenting session is RUNNING — a bearer token is copyable by
 * construction. Any renderer must say so; see
 * `packages/mcp-server/src/tools/identity.ts`.
 */

/**
 * Reserved first-party client every CLI device token is issued under. The device
 * flow mints from an authenticated session (no auth-code round-trip), so one
 * fixed client row backs them all. ⚠ `mcp_tokens.client_id` is a NOT NULL FK to
 * `oauth_clients`, so this row must exist first (`ensureDeviceClient`).
 */
export const DEVICE_CLIENT_ID = "dopl_client_device_cli";
export const DEVICE_CLIENT_NAME = "Dopl Desktop (device tokens)";

/**
 * Reserved first-party client backing every landing-page playground guest
 * token (`features/playground/server/service.ts`). Same FK rationale as the
 * device client above. ⚠ Deliberately NOT a new `McpCredentialKind`: widening
 * that union ripples into every identity renderer, and "oauth-app" with this
 * label describes the credential truthfully enough for a 24-hour demo.
 */
export const PLAYGROUND_CLIENT_ID = "dopl_client_playground";
export const PLAYGROUND_CLIENT_NAME = "Dopl Playground";

/**
 * How the credential was obtained.
 *   - `device` — minted from an interactive session for a CLI/desktop listener
 *     (`POST /api/auth/mcp-device-token`, cookie-only).
 *   - `oauth-app` — granted to a registered MCP client via authorization-code.
 */
export type McpCredentialKind = "device" | "oauth-app";

export interface McpCredential {
  kind: McpCredentialKind;
  /** ⚠ VERBATIM and UNTRUSTED — neutralize before rendering. Null when the mint
   *  stored none. */
  label: string | null;
}

/**
 * Classify a validated `mcp_tokens` row. ⚠ Keyed on `client_id` ALONE — that id
 * is server-owned (`ensureDeviceClient` upserts it), while `client_name` is
 * caller-supplied on both paths and can never be the discriminator: a DCR app
 * registering itself as "Dopl Desktop (device tokens)" must still be `oauth-app`.
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
