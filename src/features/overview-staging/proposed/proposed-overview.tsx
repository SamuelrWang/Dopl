"use client";

import { useState } from "react";
import type { SettingsSection } from "@/shared/layout/settings-modal/settings-modal-core";
import { PageError } from "@/shared/ui/page-error";
import { GHOST_FLAT_FACE, SkeletonLine } from "@/shared/ui/skeleton";
import { SkeletonSurface } from "@/shared/ui/skeleton-surface";
import { USAGE_SCOPE_ALL } from "@/features/home/overview-types";
import { monthKey } from "@/features/home/overview-period";
import { EMPTY_PREVIEW_LIST } from "@/features/home/preview-types";
import type { HomeChannelOption } from "@/features/home/components/overview/overview-credits";
import type { NeedsNavigation } from "@/features/home/components/overview/overview-needs";
import { GhostRows } from "@/features/home/components/overview/overview-skeleton";
import type {
  HomeOverviewReadArgs,
  HomeOverviewReads,
} from "@/features/home/components/overview/use-home-overview-reads";
import { ActivitySection, AgentsSection } from "./proposed-agents";
import { DevicesSection } from "./proposed-devices";
import { LedgerPanel } from "./proposed-ledger";
import { NeedsSection } from "./proposed-needs";
import { UsageSection } from "./proposed-usage";
import styles from "./proposed.module.css";

/**
 * PROPOSED Overview (staging fork of `home/components/overview/home-overview.tsx › HomeOverview`,
 * same props). No summary strip: each section's header carries its own count. Three surfaces: the
 * left panel (Needs you, Agents), the right panel (Usage, Devices, Activity), and the ledger panel
 * under them (Channels; People beside MCP tools).
 */
export function ProposedOverview({
  homeWorkspaceId,
  homeChannels,
  onOpenSettings,
  onOpenChannel,
  onOpenMessage,
  onOpenTask,
  useReads,
}: NeedsNavigation & {
  homeWorkspaceId: string | null;
  homeChannels: readonly HomeChannelOption[];
  onOpenSettings: (section: SettingsSection) => void;
  onOpenChannel: (workspaceId: string) => void;
  useReads: (args: HomeOverviewReadArgs) => HomeOverviewReads;
}) {
  const [scope, setScope] = useState<string>(USAGE_SCOPE_ALL);
  const [month, setMonth] = useState<string>(() => monthKey());
  const reads = useReads({ scope, month, homeWorkspaceId });
  const { overview, preview } = reads;

  if (overview.error) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageError error={overview.error} onRetry={() => void overview.refetch()} />
      </div>
    );
  }
  if (!overview.data) return <ProposedSkeleton />;

  const hosts = preview?.hosts?.length ? preview.hosts : null;
  const routes = preview?.routes ?? EMPTY_PREVIEW_LIST;
  const logs = preview?.logs ?? EMPTY_PREVIEW_LIST;
  const activity = routes.length > 0 || logs.length > 0;

  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        <div className={styles.grid} data-full={Boolean(hosts) || activity || undefined}>
          <div className={styles.panel}>
            <NeedsSection
              wallet={reads.wallet}
              needs={reads.needs}
              preview={preview}
              onOpenMessage={onOpenMessage}
              onOpenTask={onOpenTask}
            />
            {hosts && <AgentsSection hosts={hosts} />}
          </div>
          <div className={styles.panel}>
            <UsageSection
              wallet={reads.wallet}
              series={reads.series}
              spend={reads.spend}
              scope={scope}
              month={month}
              channels={homeChannels}
              onScope={setScope}
              onMonth={setMonth}
              onGetCredits={() => onOpenSettings("billing")}
            />
            <DevicesSection devices={reads.devices} preview={preview} onAddDevice={() => onOpenSettings("devices")} />
            {activity && <ActivitySection routes={routes} logs={logs} />}
          </div>
        </div>
        <LedgerPanel data={overview.data} channels={homeChannels} onOpenChannel={onOpenChannel} />
        {overview.data.truncated && (
          <p className={styles.note}>From the newest {overview.data.scanned.toLocaleString()} events.</p>
        )}
      </div>
    </div>
  );
}

/** The proposed geometry as ghosts: two column panels over the ledger panel. */
function ProposedSkeleton() {
  const ghost = (sections: number[]) => (
    <div className={`${GHOST_FLAT_FACE} ${styles.panel}`}>
      {sections.map((rows, i) => (
        <div key={i} className={styles.section}>
          <SkeletonLine w="30%" h={12} />
          <GhostRows count={rows} />
        </div>
      ))}
    </div>
  );
  return (
    <SkeletonSurface label="Loading overview" className="flex min-w-0 flex-1">
      <div className={styles.root} aria-hidden="true">
        <div className={styles.inner}>
          <div className={styles.grid}>
            {ghost([2, 3])}
            {ghost([3, 2])}
          </div>
          {ghost([4])}
        </div>
      </div>
    </SkeletonSurface>
  );
}
