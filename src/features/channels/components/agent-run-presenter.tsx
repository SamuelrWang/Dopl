"use client";

import type { AgentRunPresenter } from "@/shared/lib/agent-run-presenter";
import { agentColorOrNull } from "@/shared/lib/agent-colors";
import { AgentFace } from "./agent-face";
import { agentLiveness } from "./agents-model";
import { agentDisplayName } from "./agents-model-identity";

/** The channels feature's own rules for an agent, for hosts that draw agents elsewhere. */
export const AGENT_RUN_PRESENTER: AgentRunPresenter = {
  name: agentDisplayName,
  state: (session) => {
    const { tone, label } = agentLiveness(session);
    return { label, live: tone === "working" };
  },
  face: (session, photo, size) => (
    <AgentFace
      size={size}
      photo={photo}
      color={agentColorOrNull(session.color)}
      runtime={session.runtimeId || null}
    />
  ),
};
