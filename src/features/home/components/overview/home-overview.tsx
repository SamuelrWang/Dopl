"use client";

import { useState } from "react";
import type { SettingsSection } from "@/shared/layout/settings-modal/settings-modal-core";
import { PageError } from "@/shared/ui/page-error";
import { USAGE_SCOPE_ALL } from "@/features/home/overview-types";
import { monthKey } from "@/features/home/overview-period";
import { CreditsCard, type HomeChannelOption } from "./overview-credits";
import { EMPTY_PREVIEW_LIST } from "@/features/home/preview-types";
import { ActivityCard, AgentsCard } from "./overview-agents";
import { DevicesCard } from "./overview-devices";
import { ChannelsTable, ClippedLine, PeopleCard, ToolsCard } from "./overview-ledger";
import { OverviewSkeleton } from "./overview-skeleton";
import { NeedsCard, type NeedsNavigation } from "./overview-needs";
import { SummaryStrip } from "./overview-summary";
import { TokensCard } from "./overview-tokens";
import { useHomeOverviewReads, type HomeOverviewReads, type HomeOverviewReadArgs } from "./use-home-overview-reads";
import styles from "./overview.module.css";

/**
 * /home → Overview: one account-wide face. A summary strip; two columns that end on one line
 * (Needs you and Devices; Credits and Tokens), each card scrolling under its title; the channels
 * table; People beside MCP tools. The credit figures are the reader's personal wallet's, and the
 * scope and month move only the daily bars, never the allowance. An account with preview data for
 * Agents or Activity gets the three-card columns instead (Needs you, Agents, Activity; Credits,
 * Tokens, Devices).
 */
export function HomeOverview({
  homeWorkspaceId,
  homeChannels,
  onOpenSettings,
  onOpenChannel,
  onOpenMessage,
  onOpenTask,
  useReads = useHomeOverviewReads,
}: NeedsNavigation & {
  homeWorkspaceId: string | null;
  /** The operator's home channels, for the usage scope and the Channels table's faces. */
  homeChannels: readonly HomeChannelOption[];
  onOpenSettings: (section: SettingsSection) => void;
  /** Raises the Channel face on the channel this container holds. */
  onOpenChannel: (workspaceId: string) => void;
  useReads?: (args: HomeOverviewReadArgs) => HomeOverviewReads;
}) {
  const [scope, setScope] = useState<string>(USAGE_SCOPE_ALL);
  const [month, setMonth] = useState<string>(() => monthKey());
  const reads = useReads({ scope, month, homeWorkspaceId });
  const { overview } = reads;

  if (overview.error) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageError error={overview.error} onRetry={() => void overview.refetch()} />
      </div>
    );
  }
  if (!overview.data) return <OverviewSkeleton />;

  const { preview } = reads;
  const hosts = preview?.hosts?.length ? preview.hosts : null;
  const routes = preview?.routes ?? EMPTY_PREVIEW_LIST;
  const logs = preview?.logs ?? EMPTY_PREVIEW_LIST;
  const activity = routes.length > 0 || logs.length > 0;
  const full = Boolean(hosts) || activity;
  const devices = (
    <DevicesCard
      devices={reads.devices}
      preview={preview}
      onAddDevice={() => onOpenSettings("devices")}
    />
  );

  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        <SummaryStrip wallet={reads.wallet} devices={reads.devices} needs={reads.needs} preview={preview} />
        <div className={styles.grid} data-full={full || undefined}>
          <div className={styles.col}>
            <NeedsCard
              wallet={reads.wallet}
              needs={reads.needs}
              preview={preview}
              onOpenMessage={onOpenMessage}
              onOpenTask={onOpenTask}
            />
            {hosts && <AgentsCard hosts={hosts} />}
            {activity && <ActivityCard routes={routes} logs={logs} />}
            {!full && devices}
          </div>
          <div className={styles.col}>
            <CreditsCard
              wallet={reads.wallet}
              series={reads.series}
              scope={scope}
              month={month}
              channels={homeChannels}
              onScope={setScope}
              onMonth={setMonth}
              onGetCredits={() => onOpenSettings("billing")}
            />
            <TokensCard spend={reads.spend} />
            {full && devices}
          </div>
        </div>
        <ChannelsTable data={overview.data} channels={homeChannels} onOpenChannel={onOpenChannel} />
        <div className={styles.pair}>
          <PeopleCard data={overview.data} />
          <ToolsCard data={overview.data} />
        </div>
        <ClippedLine data={overview.data} />
      </div>
    </div>
  );
}
