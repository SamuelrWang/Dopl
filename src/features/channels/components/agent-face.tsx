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

/** An agent as an identity (DESIGN-LANGUAGE §3): the owner's photo in the agent's colour ring,
 *  with its runtime's badge when the runtime is known. For a host that sizes the face itself. */
export function useAgentIdentity({ photo, name, color, runtime }: AgentIdentity): IdentityFacts {
  const logoFor = useRuntimeLogo();
  return { photo, name, ring: color ?? "neutral", runtimeLogo: logoFor(runtime) };
}

export function AgentFace({ size, ...agent }: AgentIdentity & { size: number }) {
  return <IdentityFace size={size} {...useAgentIdentity(agent)} />;
}

/** An own agent's runtime: its spawn stamp, else its server row's. `''` (the default adapter) names
 *  no runtime on this side, so it falls through. */
export function ownAgentRuntime(
  session: DesktopSessionSummary,
  peers: readonly ChannelPeerSession[]
): string | null {
  if (session.runtimeId) return session.runtimeId;
  const row = session.agentId ? peers.find((p) => p.name === session.agentId) : undefined;
  return row?.runtime || null;
}
