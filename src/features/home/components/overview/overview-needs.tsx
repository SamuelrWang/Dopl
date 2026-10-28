import type { ReactNode } from "react";
import { MessageCircleQuestion, ShieldCheck, Zap } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { formatClockTime, formatRelativeTime, formatShortDate } from "@/shared/lib/format-time";
import { EMPTY_PREVIEW_LIST, type PreviewNeed } from "@/features/home/preview-types";
import { agentFaceName } from "@/shared/lib/agent-name";
import { IdentityFace } from "@/shared/ui/identity-face";
import { AgentFace } from "@/features/channels/components/agent-face";
import { TASK_TICK, TaskProgress } from "@/features/channels/components/task-bits";
import {
  EMPTY_HOME_NEED_DECISIONS,
  EMPTY_HOME_NEED_TASKS,
  type HomeNeedAuthor,
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

type NeedsReads = Pick<HomeOverviewReads, "wallet" | "needs" | "preview">;

/** How many things wait on the reader: a spent allowance, approvals and questions, decisions,
 *  tasks. `null` until the wallet and the needs read are known. */
export function needsCount({ wallet, needs, preview }: NeedsReads): string | null {
  if (wallet.loading || !needs.data) return null;
  const decisions = needs.data.decisions ?? EMPTY_HOME_NEED_DECISIONS;
  const tasks = needs.data.tasks ?? EMPTY_HOME_NEED_TASKS;
  const asks = preview?.needs ?? EMPTY_PREVIEW_LIST;
  const over = creditAllowance(wallet.credits).over ? 1 : 0;
  const clipped = needs.data.truncated?.decisions || needs.data.truncated?.tasks;
  return `${over + asks.length + decisions.length + tasks.length}${clipped ? "+" : ""}`;
}

/** A row that opens its item: the leading mark, the title over its meta, the channel at the end. */
function NeedRow({
  mark,
  title,
  meta,
  channelName,
  label,
  onOpen,
}: {
  mark: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  channelName: string;
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
      <span className={styles.rowAside}>#{channelName}</span>
    </li>
  );
}

const FACE_PX = "s" as const;

/** The asker: an agent as its identity (owner's photo in its colour ring, runtime badge), a person as their photo. */
function AuthorFace({ author, name }: { author: HomeNeedAuthor; name: string }) {
  if (author.kind === "person") return <IdentityFace size={FACE_PX} photo={author.photo} name={name} />;
  return <AgentFace size={FACE_PX} photo={author.photo} name={name} color={author.color} runtime={author.runtime} />;
}

function DecisionRow({ need, onOpen }: { need: HomeNeedDecision; onOpen: () => void }) {
  const by = need.author.kind === "agent" ? agentFaceName(need.author.name) : need.author.name || "Someone";
  return (
    <NeedRow
      mark={<AuthorFace author={need.author} name={by} />}
      title={need.question || "Needs your decision"}
      meta={`Needs your decision · ${by} · ${formatRelativeTime(need.postedAt)}`}
      channelName={need.channelName}
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
        need.dueAt ? `Due ${formatShortDate(need.dueAt)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      channelName={need.channelName}
      label={`Open task: ${need.title}`}
      onOpen={onOpen}
    />
  );
}

/** An agent's approval or open question, from the account's preview. */
function AskRow({ need }: { need: PreviewNeed }) {
  const approval = need.kind === "approval";
  return (
    <li className={styles.row}>
      <span className={styles.mark} aria-hidden="true">
        {approval ? <ShieldCheck size={13} /> : <MessageCircleQuestion size={13} />}
      </span>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{need.ask}</span>
        <span className={styles.rowMeta}>
          {[approval ? "Approval" : "Question", need.agent, need.host, formatClockTime(need.at)]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className={styles.rowAside}>#{need.channelName}</span>
    </li>
  );
}

/** What is waiting on the operator: a spent allowance, agents' asks, decision cards, then tasks. */
export function NeedsCard({
  wallet,
  needs,
  preview,
  onOpenMessage,
  onOpenTask,
}: NeedsReads & NeedsNavigation) {
  const over = !wallet.loading && creditAllowance(wallet.credits).over;
  const asks = preview?.needs ?? EMPTY_PREVIEW_LIST;
  const decisions = needs.data?.decisions ?? EMPTY_HOME_NEED_DECISIONS;
  const tasks = needs.data?.tasks ?? EMPTY_HOME_NEED_TASKS;
  const count = needsCount({ wallet, needs, preview });
  const failed = Boolean(needs.error) && !needs.data;
  const settled = !wallet.loading && needs.data !== undefined;
  const empty =
    settled && !over && asks.length === 0 && decisions.length === 0 && tasks.length === 0;
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
          {asks.map((need) => (
            <AskRow key={need.id} need={need} />
          ))}
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
