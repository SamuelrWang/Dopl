"use client";

import {
  ChevronRight,
  Copy,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Search,
  Star,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { DemoShell, useDemoTimeline } from "./demo-shell";

/**
 * Animated miniature of the Chats archive (real page's classes: 372px-ish
 * list pane, folder strips, two-line rows, document-style transcript).
 * Scenario: a Claude Code session lands in the archive, the selection
 * jumps to it, and its transcript streams in.
 */

const MARKS = [1.8, 3.6, 5.4] as const;

const CAPTIONS = [
  "Every agent session exports into a shared archive",
  "A Claude Code session just landed",
  "Full transcript — summaries, with verbatim quotes kept",
  "Decisions stay searchable instead of vanishing",
] as const;

const FILTERS = ["All", "Private", "Team", "Shared"] as const;

interface DemoRow {
  title: string;
  date: string;
  source: string;
  messages: number;
  pinned?: boolean;
  pop?: boolean;
}

const BASE_ROWS: readonly DemoRow[] = [
  { title: "Draft intro emails", date: "Jul 14", source: "Claude Code", messages: 18, pinned: true },
  { title: "Weekly pipeline review", date: "Jul 11", source: "Cursor", messages: 24 },
];

const NEW_ROW: DemoRow = {
  title: "Qualify inbound leads",
  date: "Jul 16",
  source: "Claude Code",
  messages: 12,
  pop: true,
};

interface DemoMessage {
  role: "agent" | "user";
  index: number;
  summary: string;
  verbatim?: string;
  pop?: boolean;
}

const OLD_TRANSCRIPT: readonly DemoMessage[] = [
  {
    role: "agent",
    index: 1,
    summary: "Drafted intros for the three qualified leads and linked each draft to its object.",
  },
  {
    role: "user",
    index: 2,
    summary: "Asked for a softer opening on the Northwind email.",
  },
];

const NEW_TRANSCRIPT: readonly DemoMessage[] = [
  {
    role: "agent",
    index: 1,
    summary:
      "Pulled 4 new leads from the inbox, created objects in Outreach, and drafted intros for two.",
  },
  {
    role: "user",
    index: 2,
    summary: "Asked for the Vantage Health follow-up to be scheduled.",
    verbatim: "Schedule the Vantage follow-up for Thursday and log it on the object.",
  },
  {
    role: "agent",
    index: 3,
    summary: "Updated Vantage Health — next step set to “Follow up Thu”. Ontology in sync.",
  },
];

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary";

export function ChatsDemo({
  active = true,
  paused = false,
}: {
  active?: boolean;
  paused?: boolean;
}) {
  const step = useDemoTimeline(MARKS, active, paused);

  const rows = step >= 1 ? [NEW_ROW, ...BASE_ROWS] : BASE_ROWS;
  const showNew = step >= 2;
  const selectedTitle = showNew ? NEW_ROW.title : BASE_ROWS[0].title;
  const chat = showNew ? NEW_ROW : BASE_ROWS[0];
  const transcript = showNew
    ? NEW_TRANSCRIPT.slice(0, step >= 3 ? 3 : 1).map((m, i) => ({
        ...m,
        pop: step >= 3 ? i > 0 : m.index === 1,
      }))
    : OLD_TRANSCRIPT;

  return (
    <DemoShell caption={CAPTIONS[step]}>
      <div className="page-float m-0 flex h-full w-full rounded-b-none border-b-0">
        {/* list pane */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-border-default">
          <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
            <span className="text-title font-semibold tracking-tight text-text-primary">
              Chats
            </span>
            <span className="text-caption text-text-muted">{rows.length + 5}</span>
            <span className="flex-1" />
            <span className={ICON_BTN}>
              <FolderPlus size={16} />
            </span>
          </div>
          <div className="concave-field mx-3.5 mb-3 flex h-8 items-center gap-2 rounded-[9px] px-2.5">
            <Search size={13} className="shrink-0 text-text-muted" />
            <span className="text-caption text-text-muted">Search chats</span>
          </div>
          <div className="concave-track mx-3.5 mb-3 flex items-center gap-1">
            {FILTERS.map((f) => (
              <span
                key={f}
                className={cn(
                  "flex h-[27px] flex-1 items-center justify-center rounded-[7px] text-caption font-medium",
                  f === "All" ? "raised-tab text-text-primary" : "text-text-secondary"
                )}
              >
                {f}
              </span>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden border-t border-border-default pb-4">
            {/* Outreach folder group */}
            <div className="border-b border-border-subtle">
              <div className="flex w-full items-center gap-2 pr-3.5">
                <span className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3.5 text-left">
                  <ChevronRight size={12} className="shrink-0 rotate-90 text-text-muted" />
                  <Folder size={13} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate text-small font-semibold text-text-primary">
                    Outreach
                  </span>
                </span>
                <span className="text-micro text-text-muted">{rows.length}</span>
              </div>
              {rows.map((row) => (
                <ChatRow key={row.title} row={row} selected={row.title === selectedTitle} />
              ))}
            </div>
            {/* Research folder, collapsed */}
            <div className="border-b border-border-subtle">
              <div className="flex w-full items-center gap-2 pr-3.5">
                <span className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3.5 text-left">
                  <ChevronRight size={12} className="shrink-0 text-text-muted" />
                  <Folder size={13} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate text-small font-semibold text-text-primary">
                    Research
                  </span>
                </span>
                <span className="text-micro text-text-muted">5</span>
              </div>
            </div>
          </div>
        </div>

        {/* detail pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border-default px-3.5">
            <span className="shrink-0 text-small font-medium text-text-secondary">Outreach</span>
            <ChevronRight size={13} className="shrink-0 text-text-muted" />
            <span className="min-w-0 truncate text-lead font-semibold text-text-primary">
              {selectedTitle}
            </span>
            <span className="flex-1" />
            <span className={ICON_BTN}>
              <Star size={16} />
            </span>
            <span className={ICON_BTN}>
              <Copy size={16} />
            </span>
            <span className={ICON_BTN}>
              <MoreHorizontal size={16} />
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden px-8 pb-4 pt-5">
            <div className="mx-auto max-w-[560px]">
              {/* compact header card */}
              <section
                className={cn(
                  "overflow-hidden rounded-[14px] border border-border-strong bg-bg-elevated",
                  showNew && "lp-demo-pop"
                )}
              >
                <div className="px-5 pb-3.5 pt-3.5">
                  <h2 className="break-words text-display font-semibold tracking-tight text-text-primary">
                    {selectedTitle}
                  </h2>
                  <p className="mt-2 text-caption text-text-muted">
                    {chat.date}, 2026 · {chat.source} · {chat.messages} messages ·{" "}
                    {showNew ? "Mixed" : "Summarized"}
                  </p>
                </div>
              </section>

              <div className="mb-3 mt-5 flex items-baseline gap-2">
                <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
                  Conversation
                </span>
                <span className="text-caption text-text-muted">
                  {chat.messages} messages · {showNew ? "mixed" : "summarized"}
                </span>
              </div>

              <div className="flex flex-col gap-2.5">
                {transcript.map((message) => (
                  <article
                    key={`${selectedTitle}-${message.index}`}
                    className={cn(
                      "rounded-[10px] border px-3.5 py-2.5",
                      message.pop && "lp-demo-pop",
                      message.role === "user"
                        ? "ml-12 border-border-default bg-card-surface-subtle"
                        : "border-border-subtle bg-bg-elevated"
                    )}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className="text-micro font-medium uppercase tracking-wide text-text-muted">
                        {message.role === "user" ? "You" : "Agent"} · #{message.index}
                      </span>
                      {message.verbatim && (
                        <span className="rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
                          verbatim
                        </span>
                      )}
                    </div>
                    <p className="break-words text-body leading-relaxed text-text-primary">
                      {message.summary}
                    </p>
                    {message.verbatim && (
                      <div className="concave-field mt-2 rounded-lg px-3 py-2.5">
                        <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-text-primary">
                          {message.verbatim}
                        </p>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DemoShell>
  );
}

function ChatRow({ row, selected }: { row: DemoRow; selected: boolean }) {
  return (
    <div
      className={cn(
        "relative flex w-full flex-col gap-0.5 py-2 pl-8 pr-4 text-left",
        row.pop && "lp-demo-pop",
        selected && "bg-surface-raised-3"
      )}
    >
      {selected && (
        <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-[3px] bg-text-primary" />
      )}
      <span className="flex w-full items-center gap-1.5">
        {row.pinned && <Star size={10} className="shrink-0 fill-current text-text-muted" />}
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
          {row.title}
        </span>
        <span className="shrink-0 text-micro text-text-muted">{row.date}</span>
      </span>
      <span className="flex w-full items-center gap-1.5 text-caption text-text-secondary">
        <span>{row.source}</span>
        <span className="text-text-muted">·</span>
        <span>{row.messages} messages</span>
      </span>
    </div>
  );
}
