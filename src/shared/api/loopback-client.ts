import "server-only";
import { DoplClient } from "@dopl/client";
import { clientIdentifier } from "@dopl/mcp-server/factory";
import { readRuntimeHeader, readVendorHeader } from "@/shared/auth/runtime-header";
import { readSessionIdHeader } from "@/shared/auth/session-header";
import { resolveTransportWorkspaceId } from "@/shared/auth/mcp-transport-pin";
import { appBaseUrl } from "./loopback-base-url";

/**
 * The per-request loopback `DoplClient` an MCP transport route runs its tools
 * through, carrying the caller's credential. One construction for `/api/mcp`
 * and `/api/mcp/glasses`, so their pin, stamps and cancellation cannot drift.
 *
 * - Workspace pin: key lock first, header second (`mcp-transport-pin.ts`).
 * - Runtime, vendor and session stamps are returned with the client: callers
 *   that also name them elsewhere must reuse THIS read, never a second one.
 * - `signal` hands the caller's disconnect to the loopback.
 */
export function loopbackClient(request: Request, credential: string, apiKeyWorkspaceId: string | null) {
  const runtime = readRuntimeHeader(request);
  const vendor = readVendorHeader(request);
  const sessionId = readSessionIdHeader(request);
  const client = new DoplClient(appBaseUrl(request), credential, {
    clientIdentifier,
    workspaceId: resolveTransportWorkspaceId(apiKeyWorkspaceId, request.headers.get("x-workspace-id")),
    runtime,
    vendor,
    sessionId,
    signal: request.signal,
  });
  return { client, runtime, vendor, sessionId };
}
