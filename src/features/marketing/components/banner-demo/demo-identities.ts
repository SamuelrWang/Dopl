/**
 * **WHO OWNS EACH DEMO AGENT, AND WHAT IT RUNS ON** — the one answer every redesigned
 * face reads (`docs/DESIGN-LANGUAGE.md` §3: the identity avatar is the owner's photo plus
 * the runtime badge in the agent's colour ring).
 *
 * The owner comes from the server projection (`SERVER_SESSIONS`, who is running it), the
 * colour from the roster (`AGENT_INDEX`). The runtime is demo-only: the scene's sessions
 * carry none, so this states one per agent, mixed across owners so the room shows more
 * than one runtime.
 */

import type { AgentColorKey } from "@dopl/contracts";
import { AGENT_IDS, AGENT_INDEX, FACE, SERVER_SESSIONS } from "./demo-data";

const RUNTIMES = {
  claude: { name: "Claude", logo: "/img/onboarding/claude-logo.svg" },
  chatgpt: { name: "ChatGPT", logo: "/img/onboarding/chatgpt-logo.svg" },
  grok: { name: "Grok", logo: "/img/logos/grok-bot.png" },
} as const;

type RuntimeKey = keyof typeof RUNTIMES;

const AGENT_RUNTIME: Record<string, RuntimeKey> = {
  // Daniel's
  [AGENT_IDS.planner]: "claude",
  [AGENT_IDS.teardown]: "claude",
  // Grace's
  [AGENT_IDS.triage]: "chatgpt",
  [AGENT_IDS.notice]: "chatgpt",
  // Anthony's
  [AGENT_IDS.scout]: "grok",
  [AGENT_IDS.wake]: "grok",
};

export type IdentityFace = {
  photo: string | null;
  color: AgentColorKey | null;
  logo: string;
  runtime: string;
};

export function identityFace(agentId: string | null | undefined): IdentityFace {
  const id = agentId ?? "";
  const owner = SERVER_SESSIONS.find((r) => r.name === id)?.userId;
  const runtime = RUNTIMES[AGENT_RUNTIME[id] ?? "claude"];
  return {
    photo: (owner ? FACE[owner as keyof typeof FACE] : null) ?? null,
    color: AGENT_INDEX.get(id)?.color ?? null,
    logo: runtime.logo,
    runtime: runtime.name,
  };
}

/** The agent behind a display name (thread-info rows label peers by instance id too). */
export function agentIdByLabel(label: string): string | null {
  const t = label.trim();
  for (const [id, entry] of AGENT_INDEX) {
    if (id === t || entry.displayName === t) return id;
  }
  return null;
}
