"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SettingsSection } from "@/shared/layout/settings-modal/settings-modal-core";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import {
  openStagingSettings,
  useStagingPopups,
} from "@/features/ui-staging/staging-popups-provider";
import { raiseStagingSignInPrompt } from "@/features/settings-staging/desktop-ops";
import { STAGING_TOASTS, StagingChannelPeople } from "./staging-popups";

/**
 * `/popups` — the catalog of every global popup and window, in the shared staging frame: a plain
 * list of buttons, one per popup, each opening the SAME product instance the frame's own trigger
 * opens (`ui-staging/staging-popups-provider.tsx`). The Settings rows open the header Profile
 * pill's modal through `openStagingSettings`. Staging only.
 */

const SETTINGS_ROWS: ReadonlyArray<{ id: SettingsSection; label: string }> = [
  { id: "workspaces", label: "Workspaces" },
  { id: "agents", label: "Agents" },
  { id: "devices", label: "Devices" },
  { id: "configuration", label: "Configuration" },
  { id: "notifications", label: "Notifications" },
  { id: "account", label: "Account" },
  { id: "billing", label: "Plans & Billing" },
];

export function PopupsCatalogPage() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <StagingFrame tab="channels" recordClassName="flex-col">
        <Catalog />
      </StagingFrame>
    </QueryClientProvider>
  );
}

function Catalog() {
  const popups = useStagingPopups();
  return (
    <div className="pps-catalog">
      <Group title="Settings (Profile)">
        {SETTINGS_ROWS.map((row) => (
          <OpenScaleButton key={row.id} onClick={() => openStagingSettings(row.id)}>
            {row.label}
          </OpenScaleButton>
        ))}
        <OpenScaleButton onClick={() => openStagingSettings("billing", "free")}>
          Plans & Billing (free plan)
        </OpenScaleButton>
      </Group>

      <Group title="/home header">
        <OpenScaleButton onClick={() => popups.open("new-channel")}>New channel</OpenScaleButton>
        <OpenScaleButton onClick={popups.openSearch}>Search popup</OpenScaleButton>
      </Group>

      <Group title="Account rail">
        <OpenScaleButton onClick={() => popups.open("new-workspace")}>
          New workspace (request access)
        </OpenScaleButton>
      </Group>

      <Group title="Channel Info → People">
        <p className="text-caption text-text-muted">Add person, Remove, Leave and Revoke open from the card.</p>
      </Group>
      <StagingChannelPeople />

      <Group title="App-level">
        <OpenScaleButton onClick={() => raiseStagingSignInPrompt("grok")}>Runtime sign-in prompt</OpenScaleButton>
        {STAGING_TOASTS.map((t) => (
          <OpenScaleButton key={t.label} onClick={t.fire}>
            {t.label}
          </OpenScaleButton>
        ))}
      </Group>

      <Group title="Windows">
        <OpenScaleButton onClick={() => popups.open("thread-window")}>Thread window</OpenScaleButton>
        <OpenScaleButton onClick={() => popups.open("agent-window")}>Agent window</OpenScaleButton>
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-2 mt-5 first:mt-0">
      <h2 className={cn("mb-2", IDENTITY_NAME_TEXT)}>{title}</h2>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}
