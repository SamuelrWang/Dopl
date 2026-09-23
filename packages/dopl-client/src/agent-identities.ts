/**
 * Agent-identity methods (class side: `client-agent-identities.ts`). `DELETE` is app-only and
 * deliberately unbound. Identities are addressed by UUID (the route 400s anything else); name→id
 * resolution is the MCP layer's (`packages/mcp-server/src/tools/agent-shared.ts`).
 */

import { DoplApiError } from "./errors.js";
import type { DoplTransport } from "./transport.js";
import type {
  AgentIdentity,
  AgentIdentityCreateInput,
  AgentIdentityListPayload,
  AgentIdentityUpdateInput,
  IdentityShelf,
} from "./agent-identity-types.js";

const enc = encodeURIComponent;

/** The identities this caller may see; `shelf` absent = both shelves. */
export async function listAgentIdentitiesPayload(
  t: DoplTransport,
  opts: { shelf?: IdentityShelf } = {}
): Promise<AgentIdentityListPayload> {
  const qs = opts.shelf ? `?shelf=${enc(opts.shelf)}` : "";
  return t.request<AgentIdentityListPayload>(`/api/agent-identities${qs}`, {
    toolName: "agent_list_identities",
  });
}

/** The rows alone (same single request as {@link listAgentIdentitiesPayload}). */
export async function listAgentIdentities(
  t: DoplTransport,
  opts: { shelf?: IdentityShelf } = {}
): Promise<AgentIdentity[]> {
  return (await listAgentIdentitiesPayload(t, opts)).identities;
}

export async function getAgentIdentity(
  t: DoplTransport,
  identityId: string
): Promise<AgentIdentity> {
  const data = await t.request<{ identity: AgentIdentity }>(
    `/api/agent-identities/${enc(identityId)}`,
    { toolName: "agent_get_identity" }
  );
  return data.identity;
}

export async function createAgentIdentity(
  t: DoplTransport,
  input: AgentIdentityCreateInput
): Promise<AgentIdentity> {
  const data = await t.request<{ identity: AgentIdentity }>(
    "/api/agent-identities",
    { method: "POST", body: input, toolName: "agent_create_identity" }
  );
  return data.identity;
}

export async function updateAgentIdentity(
  t: DoplTransport,
  identityId: string,
  patch: AgentIdentityUpdateInput,
  expectedVersion?: string | null
): Promise<AgentIdentity> {
  // Tri-state, like `knowledge.ts › writeKbFileByPath`: a string is a compare-and-swap
  // (`X-Updated-At`, 412 on mismatch), `null` forces, `undefined` is refused HERE — the route
  // still accepts an absent header so older desktops keep last-writer-wins.
  if (expectedVersion === undefined) {
    throw new DoplApiError(
      412,
      JSON.stringify({
        error: {
          code: "EXPECTED_VERSION_REQUIRED",
          message:
            "Read this identity first and pass its Version as expected_version (or force to overwrite).",
        },
      })
    );
  }
  const data = await t.request<{ identity: AgentIdentity }>(
    `/api/agent-identities/${enc(identityId)}`,
    {
      method: "PATCH",
      body: patch,
      toolName: "agent_update_identity",
      customHeaders: expectedVersion ? { "X-Updated-At": expectedVersion } : undefined,
    }
  );
  return data.identity;
}
