/**
 * **WHO OWNS EACH DEMO AGENT, AND WHAT IT RUNS ON** — the face the demo's own redesigned boxes
 * read (`docs/DESIGN-LANGUAGE.md` §3: the owner's photo plus the runtime badge in the agent's
 * colour ring). The owner comes from the server projection (`SERVER_SESSIONS`), the colour from
 * the roster (`AGENT_INDEX`), the runtime from `AGENT_RUNTIME`, which the sessions also carry, so
 * these faces and the product's agree.
 */

import type { AgentColorKey } from "@dopl/contracts";
import { webRuntimeLogo } from "@/shared/ui/runtime-logo";
import { AGENT_INDEX, AGENT_RUNTIME, FACE, SERVER_SESSIONS } from "./demo-data";

export type IdentityFace = {
  photo: string | null;
  color: AgentColorKey | null;
  logo: string | undefined;
};

export function identityFace(agentId: string | null | undefined): IdentityFace {
  const id = agentId ?? "";
  const owner = SERVER_SESSIONS.find((r) => r.name === id)?.userId;
  return {
    photo: (owner ? FACE[owner as keyof typeof FACE] : null) ?? null,
    color: AGENT_INDEX.get(id)?.color ?? null,
    logo: webRuntimeLogo(AGENT_RUNTIME[id] ?? "claude") ?? undefined,
  };
}
