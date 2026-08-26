/**
 * 🔒 WHICH WORKSPACE DOES AN MCP TRANSPORT CONNECTION BOOT AGAINST — the one
 * line of precedence behind `src/app/api/mcp/route.ts`, extracted so it can be
 * driven by a test instead of pinned by reading a route.
 *
 * ⚠ THE ORDER IS THE WHOLE CONTENT OF THIS MODULE, and it was WRONG until
 * 2026-08-26. The route read `headerPin ?? apiKeyWorkspaceId`, which was
 * harmless for as long as `apiKeyWorkspaceId` was dead scaffolding with no
 * producer (INVARIANTS §4 recorded it as exactly that). Layer B1 gave it one —
 * `shared/auth/mcp-container-token.ts` mints a child credential carrying
 * `mcp_tokens.workspace_id` — and from that moment the order meant a
 * CLIENT-SUPPLIED HEADER OUTRANKED THE CREDENTIAL'S OWN LOCK, for the workspace
 * directory AND for B3's `lockedTo` narrowing. The agent got to choose the
 * workspace its lock existed to choose for it.
 *
 * 🔒 SO: THE KEY LOCK WINS, THE HEADER IS THE FALLBACK. That is the priority
 * `shared/auth/with-workspace-auth.ts` already states and enforces on every
 * content route ("Workspace-scoped API key's `workspace_id`. A contradicting
 * requested target 403s"), and two doors into the same system must not disagree
 * about which input is authoritative.
 *
 * ⚠ A CONTRADICTING HEADER IS IGNORED HERE, NOT REFUSED, and that is deliberate.
 * This is the transport BOOT — it picks a default for the directory, it does not
 * authorize a read. The loopback calls that follow carry the locked credential,
 * so `withWorkspaceAuth` still answers `API_KEY_WORKSPACE_MISMATCH` for any
 * per-call target that contradicts the lock. ONE refusal, in the layer that owns
 * the rows; a second one here would be a second thing to drift.
 *
 * ⚠ BLANK IS NOT A PIN, on either input. A present-but-empty `X-Workspace-Id`
 * (or a lock column left as whitespace by some storage artefact) must resolve to
 * `undefined` so boot falls back to the membership directory, rather than
 * forwarding an empty header that 400s every loopback call.
 */

export function resolveTransportWorkspaceId(
  apiKeyWorkspaceId: string | null | undefined,
  headerWorkspaceId: string | null | undefined
): string | undefined {
  return blankToUndefined(apiKeyWorkspaceId) ?? blankToUndefined(headerWorkspaceId);
}

function blankToUndefined(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}
