"use client";

import { useEffect, useState } from "react";
import type { SettingsSection } from "@/shared/layout/settings-modal/settings-modal-core";
import { cn } from "@/shared/lib/utils";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import { STAGING_HOME_WORKSPACE_ID } from "@/features/ui-staging/staging-stubs";
import { HomeOverviewPanels } from "./pages/home/overview-panels";
import { HomeOverviewD } from "./pages/home/overview-d/overview-d";
import { HomeOverviewE } from "./pages/home/overview-e/overview-e";
import { StagingSettingsModal } from "@/features/settings-staging/staging-settings-modal";
import { DEVICES_MOCK_USER_ID, type StagingPlan } from "./overview-mock-data";
import {
  DEFAULT_STAGING_STATE,
  StagingStateProvider,
  type StagingFace,
  type StagingLoad,
  type StagingState,
} from "./stubs/staging-state";
import { STAGING_OPEN_SETTINGS_EVENT } from "./stubs/home-settings-control";

/**
 * `/overview` — desktop /home → Overview (the `devices-dashboard-mock` branch version) inside the
 * landing demo's window, on fake data. The pane is `HomePane`'s Overview branch
 * (`home-panes.tsx`), which on the branch passes `currentUserId` to gate the Devices preview.
 *
 * The small toolbar bottom-right is STAGING ONLY (not part of the desktop UI): it flips the states
 * the Overview can be in, so each can be reviewed without real data.
 */
export function OverviewStagingPage() {
  const [state, setState] = useState<StagingState>(DEFAULT_STAGING_STATE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("billing");

  // `openHomeSettings(section)` (stubbed) fires this; the desktop's one-slot registry opens the
  // Settings modal on that section.
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<SettingsSection>).detail;
      setSection(detail ?? "billing");
      setSettingsOpen(true);
    };
    window.addEventListener(STAGING_OPEN_SETTINGS_EVENT, open);
    return () => window.removeEventListener(STAGING_OPEN_SETTINGS_EVENT, open);
  }, []);

  return (
    <StagingStateProvider value={state}>
      <StagingFrame tab="overview" showChannels>
        {/* `home-panes.tsx › HomePane` (branch): the Overview face. Version D is staging-only. */}
        {/* STAGING (2026-10-26): Version E, the from-scratch redesign (`overview-e/`). */}
        {state.face === "e" ? (
          <HomeOverviewE
            homeWorkspaceId={STAGING_HOME_WORKSPACE_ID}
            currentUserId={state.devicesPreview ? DEVICES_MOCK_USER_ID : null}
          />
        ) : state.face === "d" ? (
          <HomeOverviewD
            homeWorkspaceId={STAGING_HOME_WORKSPACE_ID}
            currentUserId={state.devicesPreview ? DEVICES_MOCK_USER_ID : null}
          />
        ) : (
          <HomeOverviewPanels
            homeWorkspaceId={STAGING_HOME_WORKSPACE_ID}
            currentUserId={state.devicesPreview ? DEVICES_MOCK_USER_ID : null}
          />
        )}
      </StagingFrame>
      <StagingSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        section={section}
        onSectionChange={setSection}
        plan={state.plan}
      />
      <StagingToolbar state={state} onChange={setState} />
    </StagingStateProvider>
  );
}

/* ─────────────────────────── staging-only toolbar ─────────────────────────── */

const LOADS: Array<{ key: StagingLoad; label: string }> = [
  { key: "ready", label: "Data" },
  { key: "loading", label: "Loading" },
  { key: "empty", label: "Empty" },
  { key: "error", label: "Error" },
];
const FACES: Array<{ key: StagingFace; label: string }> = [
  { key: "current", label: "Current" },
  { key: "d", label: "Version D" },
  { key: "e", label: "Version E" },
];
const PLANS: Array<{ key: StagingPlan; label: string }> = [
  { key: "free", label: "Free" },
  { key: "pro", label: "Pro" },
  { key: "exhausted", label: "Out of credits" },
];

function Segmented<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ key: K; label: string }>;
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-micro font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <div className="flex rounded-full bg-bg-inset p-0.5">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={cn(
              "cursor-pointer rounded-full px-2.5 py-1 text-caption",
              value === opt.key
                ? "bg-bg-base font-medium text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StagingToolbar({
  state,
  onChange,
}: {
  state: StagingState;
  onChange: (next: StagingState) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div
      className="bento fixed bottom-10 right-10 z-40 flex flex-col gap-2 p-2.5"
      aria-label="Staging controls"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-micro font-semibold uppercase tracking-wide text-text-secondary">
          Staging
        </span>
        <button
          type="button"
          className="cursor-pointer rounded-full px-2 py-0.5 text-caption text-text-secondary hover:bg-surface-raised-1 hover:text-text-primary"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <>
          <Segmented
            label="Version"
            options={FACES}
            value={state.face}
            onChange={(face) => onChange({ ...state, face })}
          />
          <Segmented
            label="Reads"
            options={LOADS}
            value={state.load}
            onChange={(load) => onChange({ ...state, load, epoch: state.epoch + 1 })}
          />
          <Segmented
            label="Plan"
            options={PLANS}
            value={state.plan}
            onChange={(plan) => onChange({ ...state, plan })}
          />
          <Segmented
            label="Devices"
            options={[
              { key: "on", label: "Preview on" },
              { key: "off", label: "Off" },
            ]}
            value={state.devicesPreview ? "on" : "off"}
            onChange={(v) => onChange({ ...state, devicesPreview: v === "on" })}
          />
        </>
      )}
    </div>
  );
}
