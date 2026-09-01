import type { ReactNode } from "react";
import { Bell, MessageSquare, ShieldQuestion } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type {
  HomeAttentionItem,
  HomeThreadRow,
} from "@/features/home/overview-types";

/**
 * /home Overview — **WAITING ON YOU** and **RECENT THREADS**, as two compact
 * bento cards in the Activity grid (Samuel, 2026-09-01, after a live review of
 * the first attempt).
 *
 * ⚠ **THEY WERE FULL-WIDTH `SectionPanel`s FOR ONE PASS AND THAT WAS THE
 * DEFECT.** Each panel took the whole pane, each row was three lines tall (an
 * icon tile over a title over a channel subline), and an EMPTY one still ate a
 * full-width strip to say "None running." — so a page that used to be a dense
 * bento grid became a column of giant boxes with holes in it. These are CARDS
 * now: one truncated line per item, a `py-1` rhythm, a capped list with a
 * "+N more" tail, and a one-line empty state that costs a card, not a screen.
 *
 * ⚠ CROSS-CHANNEL BY DEFINITION. "What needs me" and "what is happening right
 * now" are questions about the ACCOUNT; scoping them to whichever row the left
 * list happens to be on turns a to-do list into a filter.
 *
 * ⚠ EVERY ROW IS A CONTROL. On /home a jump is a SELECTION rather than a
 * navigation — a home channel lives in a container and containers have no page;
 * `use-activity-jump.ts` carries the whole argument.
 */

export type OpenActivity = (
  workspaceId: string,
  /** `null` opens the channel with no thread raised. */
  threadId: string | null
) => void;

/**
 * How many rows a card shows before it stops counting.
 *
 * ⚠ **A CAP ON THE RENDER, WITH THE REMAINDER STATED** — never a silent slice.
 * The server already bounds these lists; this is the second bound, and it
 * exists because a to-do list that grows without limit stops being glanceable
 * and starts being the page.
 */
const VISIBLE_ROWS = 6;

/** The shared card frame: one header line, then the list. */
function ActivityCard({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="bento flex min-w-0 flex-col p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="truncate text-label font-semibold uppercase tracking-wide text-text-secondary">
          {title}
        </h3>
        {count > 0 && (
          <span className="shrink-0 font-mono text-micro tabular-nums text-text-muted">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * One clickable row — **ONE LINE, ALWAYS.**
 *
 * ⚠ **A `<button>`, NOT A ROW WITH AN `onClick`.** Both cards navigate, so both
 * owe the keyboard and the accessibility tree a real control — and one wrapper
 * means the two lists cannot disagree about hit area, rhythm or focus ring.
 */
function Row({
  onOpen,
  Icon,
  title,
  meta,
  chip,
  at,
}: {
  onOpen: () => void;
  Icon?: LucideIcon;
  title: string;
  /** The channel, inline and muted — the panels are cross-channel, so a row has
   *  to say WHERE. ⚠ Inline, never a second line: the subline is what made
   *  these rows three deep. */
  meta?: string;
  chip?: string;
  at: string | null;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-bg-inset"
      >
        {Icon && (
          <Icon size={12} aria-hidden className="shrink-0 text-text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-body text-text-primary">
          {title}
          {meta && (
            <span className="ml-1.5 text-caption text-text-muted">{meta}</span>
          )}
        </span>
        {chip && (
          <span className="shrink-0 rounded-full bg-bg-inset px-1.5 text-micro font-medium text-text-secondary">
            {chip}
          </span>
        )}
        {at && (
          <span className="shrink-0 font-mono text-micro tabular-nums text-text-muted">
            {formatRelativeTime(at)}
          </span>
        )}
      </button>
    </li>
  );
}

/** ⚠ ONE LINE, INSIDE THE CARD. An empty state is not a reason for a surface to
 *  get bigger. */
function Empty({ words }: { words: string }) {
  return <p className="mt-2 px-1 text-caption text-text-muted">{words}</p>;
}

function More({ rest }: { rest: number }) {
  if (rest <= 0) return null;
  return (
    <li className="px-1 pt-1 text-caption text-text-muted">+{rest} more</li>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="mt-2 flex flex-col">{children}</ul>;
}

/* --------------------------- waiting on you ---------------------------- */

/**
 * What each attention KIND is, in one word, and the glyph that carries it.
 *
 * 🔒 **A CLOSED MAP OVER A CLOSED UNION.** The three kinds are the three reads
 * behind the panel (`home/server/repository-attention.ts`); a fourth lane must
 * add its row here deliberately rather than fall through to a default that
 * mislabels it.
 */
const KIND_FACE: Record<
  HomeAttentionItem["kind"],
  { label: string; Icon: LucideIcon }
> = {
  consent: { label: "Approve", Icon: ShieldQuestion },
  permission: { label: "Permission", Icon: Bell },
  mention: { label: "Mention", Icon: MessageSquare },
};

/**
 * EVERYTHING BLOCKED ON THE OPERATOR.
 *
 * ⚠ **THE THREE KINDS ARE MARKED, NOT MERGED.** "An agent cannot send until you
 * decide", "an agent is sitting on a tool gate" and "somebody tagged you" are
 * different obligations with different urgency, and the server already orders
 * them that way (`overview-tally.ts › mapAttention`). The chip is what stops the
 * list reading as one undifferentiated inbox.
 *
 * ⚠ **WHAT THIS CARD CANNOT SEE, AND WHY IT DOES NOT PRETEND.** A tool-gate
 * PROMPT — its text, the tool it names, the choices — never leaves the desktop;
 * the server has only `channel_sessions.detail`, a coarse closed key. So a
 * `permission` row names the AGENT and where it is, and the operator answers on
 * the machine running it. Do not add a summary line the wire cannot fill.
 */
export function WaitingOnYou({
  rows,
  onOpen,
}: {
  rows: readonly HomeAttentionItem[];
  onOpen: OpenActivity;
}) {
  const shown = rows.slice(0, VISIBLE_ROWS);
  return (
    <ActivityCard title="Waiting on you" count={rows.length}>
      {rows.length === 0 ? (
        <Empty words="Nothing needs you." />
      ) : (
        <List>
          {shown.map((row) => {
            const { label, Icon } = KIND_FACE[row.kind];
            return (
              <Row
                key={row.id}
                onOpen={() => onOpen(row.workspaceId, row.threadId)}
                Icon={Icon}
                title={row.title}
                meta={row.channelName || undefined}
                chip={label}
                at={row.at}
              />
            );
          })}
          <More rest={rows.length - shown.length} />
        </List>
      )}
    </ActivityCard>
  );
}

/* ---------------------------- recent threads ---------------------------- */

/**
 * THREADS ACTIVE IN THE LAST FEW MINUTES.
 *
 * ⚠ **THE WINDOW IS THE SERVER'S AND IT IS NOT THE PAGE'S RANGE** —
 * `service-overview.ts › RECENT_THREAD_MINUTES`. The card answers "what is
 * happening right now", so an empty one is the honest picture of a quiet
 * afternoon; back-filling it from the month would make it a second thread list.
 */
export function RecentThreads({
  rows,
  onOpen,
}: {
  rows: readonly HomeThreadRow[];
  onOpen: OpenActivity;
}) {
  const shown = rows.slice(0, VISIBLE_ROWS);
  return (
    <ActivityCard title="Recent threads" count={rows.length}>
      {rows.length === 0 ? (
        <Empty words="Nothing active right now." />
      ) : (
        <List>
          {shown.map((row) => (
            <Row
              key={row.id}
              onOpen={() => onOpen(row.workspaceId, row.id)}
              title={row.title}
              meta={row.channelName || undefined}
              // ⚠ CLOSED threads are MARKED, not dropped: a thread closed ten
              // minutes ago is the most relevant thing that happened in a
              // channel, and hiding it would make a busy hour look empty.
              chip={row.status === "closed" ? "Closed" : undefined}
              at={row.lastActivityAt}
            />
          ))}
          <More rest={rows.length - shown.length} />
        </List>
      )}
    </ActivityCard>
  );
}
