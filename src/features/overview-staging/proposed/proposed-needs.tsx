import { useState, type ReactNode } from "react";
import { ListTodo, MessageCircleQuestion, ShieldCheck, Split, Zap } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { formatClockTime, formatRelativeTime, formatShortDate } from "@/shared/lib/format-time";
import { agentFaceName } from "@/shared/lib/agent-name";
import { EMPTY_PREVIEW_LIST } from "@/features/home/preview-types";
import { TaskProgress } from "@/features/channels/components/task-bits";
import { EMPTY_HOME_NEED_DECISIONS, EMPTY_HOME_NEED_TASKS } from "@/features/home/needs-types";
import { creditAllowance } from "@/features/home/components/overview/overview-credits";
import type { NeedsNavigation } from "@/features/home/components/overview/overview-needs";
import { GhostRows } from "@/features/home/components/overview/overview-skeleton";
import type { HomeOverviewReads } from "@/features/home/components/overview/use-home-overview-reads";
import { Section } from "./proposed-section";
import styles from "./proposed.module.css";

type NeedsReads = Pick<HomeOverviewReads, "wallet" | "needs" | "preview">;

/** Rows shown before "View all". */
const NEEDS_SHOWN = 5;
const ICON = 13;

/** One row's parts. Every kind wears the same 24px slot with one icon, so titles align. */
interface NeedItem {
  key: string;
  icon: ReactNode;
  attention?: boolean;
  title: ReactNode;
  /** At most two facts. */
  meta: string;
  /** The channel, shown once, at the row's end. */
  channel?: string;
  label?: string;
  onOpen?: () => void;
}

/** The waiting items, a spent allowance first, plus whether the server clipped a list. `null`
 *  until the wallet and the needs read are known. */
function needItems(
  { wallet, needs, preview }: NeedsReads,
  { onOpenMessage, onOpenTask }: NeedsNavigation
): { items: NeedItem[]; clipped: boolean } | null {
  if (wallet.loading || !needs.data) return null;
  const items: NeedItem[] = [];
  if (creditAllowance(wallet.credits).over) {
    items.push({
      key: "over",
      icon: <Zap size={ICON} />,
      attention: true,
      title: "Out of credits",
      meta: wallet.credits.periodEnd ? `Resets ${formatShortDate(wallet.credits.periodEnd)}` : "",
    });
  }
  for (const ask of preview?.needs ?? EMPTY_PREVIEW_LIST) {
    items.push({
      key: ask.id,
      icon: ask.kind === "approval" ? <ShieldCheck size={ICON} /> : <MessageCircleQuestion size={ICON} />,
      title: ask.ask,
      meta: `${ask.agent} · ${formatClockTime(ask.at)}`,
      channel: ask.channelName,
    });
  }
  for (const need of needs.data.decisions ?? EMPTY_HOME_NEED_DECISIONS) {
    const by = need.author.kind === "agent" ? agentFaceName(need.author.name) : need.author.name || "Someone";
    items.push({
      key: need.messageId,
      icon: <Split size={ICON} />,
      title: need.question || "Needs your decision",
      meta: `${by} · ${formatRelativeTime(need.postedAt)}`,
      channel: need.channelName,
      label: `Open decision: ${need.question}`,
      onOpen: () => onOpenMessage(need.workspaceId, need.threadId, need.seq),
    });
  }
  for (const task of needs.data.tasks ?? EMPTY_HOME_NEED_TASKS) {
    items.push({
      key: task.taskId,
      icon: <ListTodo size={ICON} />,
      title: (
        <>
          <span className="truncate">{task.title}</span>
          <TaskProgress task={task} />
        </>
      ),
      meta: [task.status === "in_progress" ? "In progress" : "Open", task.dueAt ? `Due ${formatShortDate(task.dueAt)}` : null]
        .filter(Boolean)
        .join(" · "),
      channel: task.channelName,
      label: `Open task: ${task.title}`,
      onOpen: () => onOpenTask(task.workspaceId, task.taskId),
    });
  }
  return { items, clipped: Boolean(needs.data.truncated?.decisions || needs.data.truncated?.tasks) };
}

/** The real count; a clipped list (the server stopped at its ceiling) floors to tens: `23` → `"20+"`. */
export function needsLabel(count: number, clipped: boolean): string {
  if (!clipped) return String(count);
  return `${count >= 10 ? Math.floor(count / 10) * 10 : count}+`;
}

function NeedRow({ item }: { item: NeedItem }) {
  const text = (
    <>
      <span className={styles.rowTitle}>{item.title}</span>
      {item.meta && <span className={styles.rowMeta}>{item.meta}</span>}
    </>
  );
  return (
    <li className={cn(styles.row, item.onOpen && styles.openRow)}>
      <span className={styles.slot} data-tone={item.attention ? "attention" : undefined} aria-hidden="true">
        {item.icon}
      </span>
      {item.onOpen ? (
        <button type="button" className={cn(styles.rowMain, styles.open)} aria-label={item.label} onClick={item.onOpen}>
          {text}
        </button>
      ) : (
        <span className={styles.rowMain}>{text}</span>
      )}
      {item.channel && <span className={styles.rowAside}>#{item.channel}</span>}
    </li>
  );
}

/** What is waiting on the operator. Five rows, then "View all" opens the rest in place. */
export function NeedsSection(props: NeedsReads & NeedsNavigation) {
  const [all, setAll] = useState(false);
  const result = needItems(props, props);
  const failed = Boolean(props.needs.error) && !props.needs.data;
  const items = result?.items ?? [];
  const more = items.length > NEEDS_SHOWN || Boolean(result?.clipped);
  return (
    <Section
      title="Needs you"
      count={result ? needsLabel(items.length, result.clipped) : undefined}
      attention={items.length > 0}
      className={all ? undefined : styles.needs}
      aside={
        more && (
          <button type="button" className={styles.link} onClick={() => setAll((open) => !open)}>
            {all ? "Show less" : "View all"}
          </button>
        )
      }
    >
      {failed && <p className={styles.note}>Couldn&apos;t load your tasks and decisions.</p>}
      {!result && !failed ? (
        <GhostRows count={2} />
      ) : result && items.length === 0 ? (
        <EmptyState variant="outline" title="Nothing waiting" />
      ) : (
        <ul className={styles.rows}>
          {(all ? items : items.slice(0, NEEDS_SHOWN)).map((item) => (
            <NeedRow key={item.key} item={item} />
          ))}
        </ul>
      )}
    </Section>
  );
}
