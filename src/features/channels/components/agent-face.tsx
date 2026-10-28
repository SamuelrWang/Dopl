"use client";

import type { AgentColorKey } from "@dopl/contracts";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { IdentityFace, type IdentityFacts } from "@/shared/ui/identity-face";
import { useRuntimeLogo } from "@/shared/ui/runtime-logo";
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";

interface AgentIdentity {
  photo: string | null | undefined;
  /** Initials when there is no photo. */
  name?: string | null;
  color: AgentColorKey | null | undefined;
  runtime: string | null | undefined;
}

/** Who the agents in a channel are: this machine's feed and the peer projection. */
export interface AgentFeeds {
  /** This machine's feed; `null` is "could not ask" and contributes no own rows. */
  sessions: readonly DesktopSessionSummary[] | null;
  peers: readonly ChannelPeerSession[];
}

/** An agent as an identity (DESIGN-LANGUAGE §3): the owner's photo in the agent's colour ring,
 *  with its runtime's badge when the runtime is known. */
export function agentIdentity(
  { photo, name, color, runtime }: AgentIdentity,
  logoFor: (runtime: string | null | undefined) => string | null
): IdentityFacts {
  return { photo, name, ring: color ?? "neutral", runtimeLogo: logoFor(runtime) };
}

/** {@link agentIdentity} for a host that sizes the face itself. */
export function useAgentIdentity(agent: AgentIdentity): IdentityFacts {
  return agentIdentity(agent, useRuntimeLogo());
}

export function AgentFace({ size, ...agent }: AgentIdentity & { size: number }) {
  return <IdentityFace size={size} {...useAgentIdentity(agent)} />;
}

/**
 * An agent's runtime: an own agent's spawn stamp, else its server row's. `''` (the default
 * adapter) names no runtime on this side, so it falls through. `own` defaults to this machine's
 * session with that id; a caller already holding the session passes it.
 */
export function agentRuntime(
  feeds: AgentFeeds,
  agentId: string | null | undefined,
  own = agentId ? feeds.sessions?.find((s) => s.agentId === agentId) : undefined
): string | null {
  if (own?.runtimeId) return own.runtimeId;
  const row = agentId ? feeds.peers.find((p) => p.name === agentId) : undefined;
  return row?.runtime || null;
}
