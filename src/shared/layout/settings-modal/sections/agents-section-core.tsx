"use client";

// ⚠ Deep import, NOT a barrel — barrels drag sibling components the desktop renderer doesn't need.
import { AgentsPanel } from "@/features/devices/components/agents-panel";
import { SettingsPane } from "./settings-panel";

/**
 * AGENTS (Samuel, 2026-10-02) — the agent apps connected to Dopl, runtime sign-in, and how to
 * connect one. Was the first half of the deleted Connect tab; Devices is its own tab now
 * (`./devices-section-core.tsx`). Account-scoped: `/api/mcp` and `/api/oauth/apps` read no
 * workspace.
 */
export function AgentsSectionCore() {
  return (
    <SettingsPane>
      <AgentsPanel />
    </SettingsPane>
  );
}
