import type { ReactNode } from "react";
import { CircleHelp, Zap } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { formatRelativeTime, formatShortDate } from "@/shared/lib/format-time";
import { TASK_TICK, TaskProgress } from "@/features/channels/components/task-bits";
import {
  EMPTY_HOME_NEED_DECISIONS,
  EMPTY_HOME_NEED_TASKS,
  type HomeNeedDecision,
  type HomeNeedTask,
} from "@/features/home/needs-types";
import { OverviewCard } from "./overview-card";
import { creditAllowance } from "./overview-credits";
import { GhostRows } from "./overview-skeleton";
import type { HomeOverviewReads } from "./use-home-overview-reads";
import styles from "./overview.module.css";

export interface NeedsNavigation {
  /** Lands on a message in its channel (and thread). */
  onOpenMessage: (workspaceId: string, threadId: string | null, seq: number) => void;
  /** Opens the channel's Tasks tab on one task. */
  onOpenTask: (workspaceId: string, taskId: string) => void;
}

/** How many things wait on the reader: a spent allowance, decisions, tasks. `null` until all are known. */
export function needsCount({
  wallet,
  needs,
}: Pick<HomeOverviewReads, "wallet" | "needs">): string | null {
  if (wallet.loading || !needs.data) return null;
  const decisions = needs.data.decisions ?? EMPTY_HOME_NEED_DECISIONS;
  const tasks = needs.data.tasks ?? EMPTY_HOME_NEED_TASKS;
  const over = creditAllowance(wallet.credits).over ? 1 : 0;
  const clipped = needs.data.truncated?.decisions || needs.data.truncated?.tasks;
  return `${over + decisions.length + tasks.length}${clipped ? "+" : ""}`;
}

function NeedRow({
  mark,
  title,
  meta,
  label,
  onOpen,
}: {
  mark: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  label: string;
  onOpen: () => void;
}) {
  return (
    <li className={cn(styles.row, styles.openRow)}>
      {mark}
      <button type="button" className={cn(styles.rowMain, styles.open)} aria-label={label} onClick={onOpen}>
        <span className={styles.rowTitle}>{title}</span>
        <span className={styles.rowMeta}>{meta}</span>
      </button>
    </li>
  );
}

function DecisionRow({ need, onOpen }: { need: HomeNeedDecision; onOpen: () => void }) {
  const by = need.author.kind === "agent" ? "Agent" : need.author.name || "Someone";
  return (
    <NeedRow
      mark={
        <span className={styles.mark} aria-hidden="true">
          <CircleHelp size={13} />
        </span>
      }
      title={need.question || "Needs your decision"}
      meta={`Needs your decision · #${need.channelName} · ${by} · ${formatRelativeTime(need.postedAt)}`}
      label={`Open decision: ${need.question}`}
      onOpen={onOpen}
    />
  );
}

function TaskRow({ need, onOpen }: { need: HomeNeedTask; onOpen: () => void }) {
  return (
    <NeedRow
      mark={<span data-status={need.status} aria-hidden="true" className={cn(TASK_TICK, styles.tick)} />}
      title={
        <>
          <span className="truncate">{need.title}</span>
          <TaskProgress task={need} />
        </>
      }
      meta={[
        need.status === "in_progress" ? "In progress" : "Open",
        `#${need.channelName}`,
        need.dueAt ? `Due ${formatShortDate(need.dueAt)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      label={`Open task: ${need.title}`}
      onOpen={onOpen}
    />
  );
}

/** What is waiting on the operator: a spent allowance, decision cards, then their tasks. */
export function NeedsCard({
  wallet,
  needs,
  onOpenMessage,
  onOpenTask,
}: Pick<HomeOverviewReads, "wallet" | "needs"> & NeedsNavigation) {
  const over = !wallet.loading && creditAllowance(wallet.credits).over;
  const decisions = needs.data?.decisions ?? EMPTY_HOME_NEED_DECISIONS;
  const tasks = needs.data?.tasks ?? EMPTY_HOME_NEED_TASKS;
  const count = needsCount({ wallet, needs });
  const failed = Boolean(needs.error) && !needs.data;
  const settled = !wallet.loading && needs.data !== undefined;
  const empty = settled && !over && decisions.length === 0 && tasks.length === 0;
  return (
    <OverviewCard title="Needs you" count={count ?? undefined} className={styles.slotNeeds}>
      {failed && <p className={styles.note}>Couldn&apos;t load your tasks and decisions.</p>}
      {!settled && !failed ? (
        <GhostRows count={2} />
      ) : empty ? (
        <EmptyState variant="outline" title="Nothing waiting" />
      ) : (
        <ul className={styles.rows}>
          {over && (
            <li className={styles.row}>
              <span className={styles.mark} data-tone="over" aria-hidden="true">
                <Zap size={13} />
              </span>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>Out of credits</span>
                {wallet.credits.periodEnd && (
                  <span className={styles.rowMeta}>
                    Resets {formatShortDate(wallet.credits.periodEnd)}
                  </span>
                )}
              </span>
            </li>
          )}
          {decisions.map((need) => (
            <DecisionRow
              key={need.messageId}
              need={need}
              onOpen={() => onOpenMessage(need.workspaceId, need.threadId, need.seq)}
            />
          ))}
          {tasks.map((need) => (
            <TaskRow
              key={need.taskId}
              need={need}
              onOpen={() => onOpenTask(need.workspaceId, need.taskId)}
            />
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}
