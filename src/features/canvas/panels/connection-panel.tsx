"use client";

/**
 * ConnectionPanelBody — the canvas surface for connecting an MCP client.
 * A thin wrapper over the shared `RemoteConnect` (the same OAuth "Connect →
 * log in" block the settings + overview surfaces render), so every surface
 * shows one connection flow.
 */

import { RemoteConnect } from "@/features/mcp-connect";

export function ConnectionPanelBody() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      <RemoteConnect />
    </div>
  );
}
