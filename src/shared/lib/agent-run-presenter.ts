import type { AvatarScale } from "@/shared/ui/avatar-size";
import type { ReactNode } from "react";
import type { DesktopSessionSummary } from "./spa-bridge";

/**
 * How a surface outside the channels feature draws one of this machine's agents: its name, its
 * one-word state and its face. The channels feature owns those rules
 * (`channels/components/agent-run-presenter.tsx › AGENT_RUN_PRESENTER`); a host hands them in.
 */
export interface AgentRunPresenter {
  name: (session: DesktopSessionSummary) => string;
  /** `live` greens the dot: the agent is working right now. */
  state: (session: DesktopSessionSummary) => { label: string; live: boolean };
  /** `photo` is the agent's owner, which on this machine's feed is always the operator. */
  face: (session: DesktopSessionSummary, photo: string | null, size: AvatarScale) => ReactNode;
}
