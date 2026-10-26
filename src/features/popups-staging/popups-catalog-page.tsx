"use client";

import type { SettingsSection } from "@/shared/layout/settings-modal/settings-modal-core";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import { useStagingPopups } from "@/features/ui-staging/staging-popups-provider";
import { raiseStagingSignInPrompt } from "@/features/settings-staging/stubs/runtime-signin";
import { HomeSettingsControl, openHomeSettings } from "./pages/home/home-settings-control";
import { STAGING_IDENTITY } from "./stubs/desktop-shell";
import { STAGING_TOASTS, StagingAccountRail, StagingChannelPeople } from "./staging-popups";

/**
 * `/popups` — the catalog of every staged global popup and window, in the shared staging frame.
 * A plain list of buttons, one per popup. Every button opens the SAME instance the frame's own
 * trigger opens (`ui-staging/staging-popups-provider.tsx › useStagingPopups`): the top bar's
 * "New channel", search and profile pills, the rail's "+", toast clicks. The Settings rows go
 * through the desktop's own `openHomeSettings` registry (the black Profile pill below owns it).
 * Staging only; nothing here ports back.
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
  return (
    <StagingFrame tab="channels" recordClassName="flex-col">
      <Catalog />
    </StagingFrame>
  );
}

function Catalog() {
  const popups = useStagingPopups();
  return (
    <div className="pps-catalog">
      <Group title="Settings (Profile)">
        {SETTINGS_ROWS.map((row) => (
          <OpenScaleButton key={row.id} onClick={() => openHomeSettings(row.id)}>
            {row.label}
          </OpenScaleButton>
        ))}
        <OpenScaleButton onClick={() => popups.openSettings("billing", "free")}>
          Plans & Billing (free plan)
        </OpenScaleButton>
        {/* The real control: `home-settings-control.tsx` owns the modal and the registry the
            buttons above call. (The frame's profile pill opens the provider's instance.) */}
        <HomeSettingsControl identity={STAGING_IDENTITY} onWorkspaceChanged={() => {}} />
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
      <StagingAccountRail />

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
