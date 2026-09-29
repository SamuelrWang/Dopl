"use client";

// ⚠ Deep imports, NOT barrels — they drag sibling components the desktop renderer doesn't need.
import { AgentsPanel } from "@/features/devices/components/agents-panel";
import { DevicesPanel } from "@/features/devices/components/devices-panel";
import { SettingsPane } from "./settings-panel";

/**
 * CONNECT — two panels (Samuel, 2026-09-28): AGENTS (the agent apps connected to Dopl + how to
 * connect one) and DEVICES (every computer and pair of glasses connected to the caller's agents).
 * Account-scoped: `/api/mcp`, `/api/oauth/apps` and `/api/devices` read no workspace.
 */
export function ConnectSectionCore() {
  return (
    <SettingsPane>
      <AgentsPanel />
      <DevicesPanel />
    </SettingsPane>
  );
}
