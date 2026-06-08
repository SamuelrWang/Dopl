"use client";

/**
 * ConnectionPanelBody — the canvas surface for connecting an MCP client.
 * A thin wrapper over the shared `ConnectionSetup` (the same component the
 * workspace overview renders), so the canvas and overview show ONE key
 * and one setup flow. The key is server state owned by `useWorkspaceKey`
 * — it is no longer cached in the canvas store.
 */

import { ConnectionSetup } from "@/features/api-keys/components/connection-setup";
import { useCanvasScope } from "../canvas-store";

export function ConnectionPanelBody() {
  const scope = useCanvasScope();
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      {scope?.workspaceSlug ? (
        <ConnectionSetup workspaceSlug={scope.workspaceSlug} />
      ) : (
        <p className="py-8 text-center text-xs text-text-muted">
          Open this from a workspace canvas to manage its API key.
        </p>
      )}
    </div>
  );
}
