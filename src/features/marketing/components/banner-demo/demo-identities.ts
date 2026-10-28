/**
 * Who owns each demo agent: the person whose photo the agent's identity face wears
 * (`docs/DESIGN-LANGUAGE.md` §3), off the server projection (`SERVER_SESSIONS`) the product reads.
 */

import { FACE, SERVER_SESSIONS } from "./demo-data";

export function agentOwner(agentId: string | null | undefined): string | null {
  return SERVER_SESSIONS.find((r) => r.name === (agentId ?? ""))?.userId ?? null;
}

export function ownerPhoto(agentId: string | null | undefined): string | null {
  const owner = agentOwner(agentId);
  return (owner ? FACE[owner as keyof typeof FACE] : null) ?? null;
}
