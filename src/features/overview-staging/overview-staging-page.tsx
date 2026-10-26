"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SettingsSection } from "@/shared/layout/settings-modal/settings-modal-core";
import { cn } from "@/shared/lib/utils";
import { HomeOverview } from "@/features/home/components/overview/home-overview";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import { STAGING_CHANNELS_HREF } from "@/features/ui-staging/staging-channel-rail";
import { STAGING_HOME_WORKSPACE_ID } from "@/features/ui-staging/staging-stubs";
import { StagingSettingsModal } from "@/features/settings-staging/staging-settings-modal";
import { HOME_CHANNELS, type StagingPlan } from "./overview-mock-data";
import {
  DEFAULT_STAGING_STATE,
  StagingStateProvider,
  type StagingLoad,
  type StagingState,
} from "./stubs/staging-state";
import { useStagingOverviewReads } from "./stubs/use-staging-overview-reads";

/**
 * `/overview`: the product Overview face inside the landing demo window, on fake data.
 *
 * The small toolbar bottom-right is STAGING ONLY (not part of the desktop UI): it flips the states
 * the Overview can be in, so each can be reviewed without real data.
 */
export function OverviewStagingPage() {
  const [state, setState] = useState<StagingState>(DEFAULT_STAGING_STATE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("billing");
  const router = useRouter();

  return (
    <StagingStateProvider value={state}>
      <StagingFrame tab="overview" showChannels>
        <HomeOverview
          homeWorkspaceId={STAGING_HOME_WORKSPACE_ID}
          homeChannels={HOME_CHANNELS}
          onOpenSettings={(next) => {
            setSection(next);
            setSettingsOpen(true);
          }}
          onOpenChannel={() => router.push(STAGING_CHANNELS_HREF)}
          onOpenMessage={() => router.push(STAGING_CHANNELS_HREF)}
          onOpenTask={() => router.push(STAGING_CHANNELS_HREF)}
          useReads={useStagingOverviewReads}
        />
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
        </>
      )}
    </div>
  );
}
