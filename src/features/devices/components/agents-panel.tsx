"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { apiRequest } from "@/shared/api/api-client";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { OpenScaleButton, OPEN_SCALE_ICON } from "@/shared/ui/open-scale-button";
import {
  RowAction,
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsRowsEmpty,
  SettingsRowsSkeleton,
} from "@/shared/layout/settings-modal/sections/settings-panel";
import { useConfirmedAction } from "@/shared/layout/settings-modal/sections/use-confirmed-action";
import { RemoteConnect } from "@/features/mcp-connect/components/remote-connect";
import { RuntimeCredentialBars } from "@/features/channels/components/runtime-credential-bars";
import { useRuntimeCredentials } from "@/features/channels/components/runtime-signin";
import { AGENT_APPS_PATH, type AgentApp } from "../types";
import { useAgentApps, useInvalidateAgentApps } from "./use-devices";

/** A card's own small heading — Overview's `RailCard` label face. */
function CardHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
      {children}
    </h3>
  );
}

/**
 * AGENTS — the agent apps connected to Dopl, one row per app (every OAuth registration of it
 * folded together, `server/agent-apps.ts`), and how to connect one. The desktop also lists the
 * runtimes Dopl runs agents on. Dopl's own credentials (the desktop's device and container-session
 * tokens) are never listed: they belong to a computer under Devices.
 */
export function AgentsPanel() {
  const [connecting, setConnecting] = useState(false);
  const { apps, failed } = useAgentApps();
  const runtimes = useRuntimeCredentials();

  return (
    <SettingsPanel
      id="settings-connect-agents"
      label="Agents"
      action={
        <OpenScaleButton onClick={() => setConnecting((open) => !open)} aria-expanded={connecting}>
          <Plus size={OPEN_SCALE_ICON} aria-hidden="true" />
          Connect an agent
        </OpenScaleButton>
      }
    >
      {connecting && (
        <SettingsCard label="Connect an agent">
          <CardHeading>Connect an agent</CardHeading>
          <RemoteConnect />
        </SettingsCard>
      )}

      <SettingsCard label="Connected agents">
        <CardHeading>Connected</CardHeading>
        <ul aria-label="Connected agents" className="mt-1 divide-y divide-border-subtle">
          {apps === null ? (
            <SettingsRowsSkeleton />
          ) : apps.length === 0 ? (
            <SettingsRowsEmpty failed={failed && "Couldn’t load your agents."}>
            No agents connected yet.
          </SettingsRowsEmpty>
          ) : (
            apps.map((app) => <AgentAppRow key={app.key} app={app} />)
          )}
        </ul>
      </SettingsCard>

      {runtimes.length > 0 && (
        <SettingsCard label="Agent sign-ins">
          <CardHeading>Sign-ins</CardHeading>
          <RuntimeCredentialBars variant="rows" className="mt-1" />
        </SettingsCard>
      )}
    </SettingsPanel>
  );
}

function AgentAppRow({ app }: { app: AgentApp }) {
  const invalidate = useInvalidateAgentApps();
  const disconnect = useConfirmedAction({
    run: () =>
      apiRequest<unknown>(`${AGENT_APPS_PATH}/${encodeURIComponent(app.key)}`, { method: "DELETE" }),
    success: `${app.name} disconnected`,
    failure: "Couldn't disconnect",
    after: invalidate,
  });
  const meta = [
    app.host,
    app.connections > 1 ? `${app.connections} connections` : null,
    app.last_used_at ? `Last used ${formatRelativeTime(app.last_used_at)}` : "Not used yet",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SettingsRow title={app.name} meta={meta}>
      <RowAction danger onClick={disconnect.ask}>
        Disconnect
      </RowAction>
      <ConfirmDialog
        {...disconnect.dialog}
        title={`Disconnect ${app.name}?`}
        confirmLabel="Disconnect"
        destructive
      />
    </SettingsRow>
  );
}
