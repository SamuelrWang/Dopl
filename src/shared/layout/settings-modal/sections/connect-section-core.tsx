"use client";

// ⚠ Deep imports, NOT the `mcp-connect` barrel — the barrel drags sibling
// components the desktop renderer doesn't need into its bundle.
import { RemoteConnect } from "@/features/mcp-connect/components/remote-connect";
import { ConnectedAppsSection } from "@/features/mcp-connect/components/connected-apps-section";
import { SectionShell } from "./section-shell";

/**
 * CONNECT — the MCP endpoint + the "Connect & log in" dance, and the grants it
 * produced (Samuel, 2026-09-18: Connect sits under Workspaces and holds the
 * connect/login content).
 *
 * ⚠ **MOVED, NOT COPIED.** `RemoteConnect` was the third block of
 * `sections/workspace-section-core.tsx › WorkspaceSectionBody` and
 * `ConnectedAppsSection` was the desktop `/settings` page's `extras` slot; both
 * are gone from those two surfaces in the same change. Two mounts of a connect
 * block is how one of them goes stale.
 *
 * ⚠ **ACCOUNT-SCOPED, WHICH IS WHY IT IS ITS OWN TAB AND NOT A WORKSPACE ONE.**
 * `/api/mcp` is one endpoint for the caller and `/api/oauth/grants` is the
 * caller's own grant list — neither reads a workspace, and hanging them off a
 * per-workspace pane implied a per-workspace URL that never existed.
 */
export function ConnectSectionCore() {
  return (
    <SectionShell title="Connect" subtitle="Reach Dopl from your MCP client">
      <RemoteConnect />
      <ConnectedAppsSection />
    </SectionShell>
  );
}
