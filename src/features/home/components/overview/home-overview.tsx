"use client";

import { useState } from "react";
import type { SettingsSection } from "@/shared/layout/settings-modal/settings-modal-core";
import { PageError } from "@/shared/ui/page-error";
import { USAGE_SCOPE_ALL } from "@/features/home/overview-types";
import { monthKey } from "@/features/home/overview-period";
import { CreditsCard, type HomeChannelOption } from "./overview-credits";
import { DevicesCard } from "./overview-devices";
import { ChannelsTable, ClippedLine, PeopleCard, ToolsCard } from "./overview-ledger";
import { OverviewSkeleton } from "./overview-skeleton";
import { NeedsCard, SummaryStrip } from "./overview-summary";
import { TokensCard } from "./overview-tokens";
import { useHomeOverviewReads, type HomeOverviewReads, type HomeOverviewReadArgs } from "./use-home-overview-reads";
import styles from "./overview.module.css";

/**
 * /home → Overview: one account-wide face. A summary strip; two columns that end on one line
 * (Needs you and Devices; Credits and Tokens), each card scrolling under its title; the channels
 * table; People beside MCP tools. The credit figures are the reader's personal wallet's, and the
 * scope and month move only the daily bars, never the allowance.
 */
export function HomeOverview({
  homeWorkspaceId,
  homeChannels,
  onOpenSettings,
  useReads = useHomeOverviewReads,
}: {
  homeWorkspaceId: string | null;
  /** The operator's home channels, for the usage scope. */
  homeChannels: readonly HomeChannelOption[];
  onOpenSettings: (section: SettingsSection) => void;
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

  const openBilling = () => onOpenSettings("billing");
  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        <SummaryStrip wallet={reads.wallet} devices={reads.devices} />
        <div className={styles.grid}>
          <div className={styles.col}>
            <NeedsCard wallet={reads.wallet} onGetCredits={openBilling} />
            <DevicesCard devices={reads.devices} onAddDevice={() => onOpenSettings("devices")} />
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
              onGetCredits={openBilling}
            />
            <TokensCard spend={reads.spend} />
          </div>
        </div>
        <ChannelsTable data={overview.data} />
        <div className={styles.pair}>
          <PeopleCard data={overview.data} />
          <ToolsCard data={overview.data} />
        </div>
        <ClippedLine data={overview.data} />
      </div>
    </div>
  );
}
