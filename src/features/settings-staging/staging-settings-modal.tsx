"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SettingsSection } from "@/shared/layout/settings-modal/settings-modal-core";
import { SettingsModal } from "./components/settings-modal/settings-modal";
import {
  STAGING_HOME_SEGMENT,
  STAGING_HOME_WORKSPACE_ID,
  type StagingPlan,
} from "./settings-mock-data";
import { StagingPlanProvider } from "./stubs/staging-settings-state";

export type { SettingsSection, StagingPlan };

/**
 * STAGING ONLY — the desktop Settings modal (`components/settings-modal/settings-modal.tsx`, the
 * staged copy) bound the way /home binds it (`home-settings-control.tsx`): the operator's default
 * workspace, owner role, every one of the seven rows.
 *
 * `open`/`onClose` is the popup contract every staged popup shares. `section` seeds the pane on each
 * open (desktop seeds it from `openHomeSettings(section)`); the rail then switches it in memory.
 * `onSectionChange` lets a caller own it instead. `plan` picks the fake billing status.
 *
 * ⚠ ITS OWN QueryClient: nothing in the staged panes reads one (every hook is stubbed), but the
 * Account pane's copy calls `useQueryClient()` to write its saved profile back. An isolated client
 * means that write can never touch the page's real cache.
 */
export function StagingSettingsModal({
  open,
  onClose,
  section = "account",
  onSectionChange,
  plan = "pro",
}: {
  open: boolean;
  onClose: () => void;
  section?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
  plan?: StagingPlan;
}) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { enabled: false } } }));
  const [local, setLocal] = useState<SettingsSection>(section);
  // Re-seed on every open, as the desktop registry does: Escape-then-reopen lands on the asked pane.
  // (React's adjust-state-while-rendering pattern: compare with the previous `open`, no effect.)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setLocal(section);
  }
  const current = onSectionChange ? section : local;

  return (
    <QueryClientProvider client={client}>
      <StagingPlanProvider plan={plan}>
        <SettingsModal
          open={open}
          onOpenChange={(next) => {
            if (!next) onClose();
          }}
          section={current}
          onSectionChange={onSectionChange ?? setLocal}
          workspaceSegment={STAGING_HOME_SEGMENT}
          workspaceId={STAGING_HOME_WORKSPACE_ID}
          role="owner"
        />
      </StagingPlanProvider>
    </QueryClientProvider>
  );
}
