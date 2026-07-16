"use client";

import {
  Bot,
  Copy,
  Download,
  Folder,
  History,
  Lock,
  Plus,
  Search,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { DemoShell, useDemoTimeline } from "./demo-shell";

/**
 * Animated miniature of the Skills page (single-file SKILL.md model:
 * 372px-ish list with folder groups, inline document editor, history
 * rail). Scenario: an agent refines a skill after a run and the change
 * lands as a new version in history.
 */

const MARKS = [1.8, 4.2] as const;

const CAPTIONS = [
  "Playbooks your agents load and follow",
  "Your agent refines the skill after a run",
  "Every change versioned — diff and restore",
] as const;

const FILTERS = ["All", "Private", "Team", "Shared"] as const;

interface SkillRowData {
  name: string;
  date: string;
  scope: "Private" | "Team" | "Shared";
  desc: string;
  draft?: boolean;
  selected?: boolean;
}

const GROUPS: readonly { folder: string; rows: readonly SkillRowData[] }[] = [
  {
    folder: "Outreach",
    rows: [
      {
        name: "Outbound email drafting",
        date: "Jul 16",
        scope: "Team",
        desc: "Drafts cold and follow-up outreach in your tone.",
        selected: true,
      },
      {
        name: "Competitor research synthesis",
        date: "Jul 12",
        scope: "Team",
        desc: "Pulls competitor signal, writes a one-pager.",
      },
    ],
  },
  {
    folder: "Unfiled",
    rows: [
      {
        name: "Spec doc writer",
        date: "Jul 8",
        scope: "Private",
        desc: "Drafts PRDs and ADRs in our house style.",
        draft: true,
      },
    ],
  },
];

const VERSIONS = [
  { when: "just now", by: "agent" },
  { when: "Jul 11", by: "user" },
  { when: "Jul 8", by: "agent" },
] as const;

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary";

export function SkillsDemo({
  active = true,
  paused = false,
}: {
  active?: boolean;
  paused?: boolean;
}) {
  const step = useDemoTimeline(MARKS, active, paused);

  const typing = step === 1;
  const historyOpen = step >= 2;

  return (
    <DemoShell caption={CAPTIONS[step]}>
      <div className="page-float m-0 flex h-full w-full rounded-b-none border-b-0">
        {/* list pane */}
        <div className="flex w-[280px] shrink-0 flex-col border-r border-border-default">
          <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
            <span className="text-title font-semibold tracking-tight text-text-primary">
              Skills
            </span>
            <span className="text-caption text-text-muted">5</span>
            <span className="flex-1" />
            <span className={ICON_BTN}>
              <Trash2 size={14} />
            </span>
            <span className={ICON_BTN}>
              <Plus size={15} />
            </span>
          </div>
          <div className="concave-field mx-3.5 mb-3 flex h-8 items-center gap-2 rounded-[9px] px-2.5">
            <Search size={13} className="shrink-0 text-text-muted" />
            <span className="text-caption text-text-muted">Search skills</span>
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
            {GROUPS.map((group) => (
              <div key={group.folder}>
                <p className="px-4 pb-1 pt-3 text-label font-medium uppercase tracking-wider text-text-muted">
                  {group.folder}
                </p>
                {group.rows.map((row) => (
                  <SkillRow key={row.name} row={row} />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* editor pane */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
            <span className="min-w-0 truncate text-title font-medium text-text-primary">
              Outbound email drafting
            </span>
            <span className="btn-light flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-caption text-text-secondary">
              <Folder size={11} /> Outreach
            </span>
            <span className="flex-1" />
            <span key={step} className="lp-demo-row-in shrink-0 text-micro text-text-muted">
              {typing ? "Saving…" : "Saved"}
            </span>
            <span className="btn-light flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary">
              <Download size={12} /> Export
            </span>
            <span className="btn-light flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary">
              <Copy size={12} /> Duplicate
            </span>
            <span
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary",
                historyOpen ? "concave-sel" : "btn-light"
              )}
            >
              <History size={12} /> History
            </span>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* SKILL.md document */}
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="mx-auto w-full max-w-[520px] px-6 pt-6">
                <p className="text-[16px] leading-[1.7] text-text-primary/90">
                  Read the user&apos;s voice from{" "}
                  <span className="text-[#2f6fed] underline decoration-[#2f6fed]/40">
                    Networking emails
                  </span>{" "}
                  before drafting. Three patterns matter: openers, asks, and sign-offs.
                </p>
                <h2 className="mt-6 mb-1.5 text-[19px] font-semibold tracking-tight text-text-primary">
                  Step 1 — Establish context
                </h2>
                <p className="my-3 text-[16px] leading-[1.7] text-text-primary/90">
                  If the user mentions a prior thread, search{" "}
                  <span className="text-[#2f6fed] underline decoration-[#2f6fed]/40">
                    Gmail threads
                  </span>{" "}
                  and quote one specific phrase from it verbatim.
                </p>
                <h2 className="mt-6 mb-1.5 text-[19px] font-semibold tracking-tight text-text-primary">
                  Step 2 — Draft
                </h2>
                <p className="my-3 text-[16px] leading-[1.7] text-text-primary/90">
                  Match the tone. Aim for under four sentences. Lead with the specific
                  reason this person matters.
                  {step >= 1 && (
                    <span className="lp-demo-row-in">
                      {" "}
                      One concrete ask. Don&apos;t apologize for the cold contact.
                      {typing && <span className="lp-demo-caret" />}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* history rail */}
            {historyOpen && (
              <aside className="lp-demo-pop flex w-60 shrink-0 flex-col overflow-hidden border-l border-border-default">
                <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
                  <History size={12} className="text-text-muted" />
                  <span className="flex-1 text-label font-semibold uppercase tracking-wide text-text-secondary">
                    History
                  </span>
                </div>
                {VERSIONS.map((v, i) => (
                  <div
                    key={v.when}
                    className="flex items-center gap-2 border-b border-border-subtle px-3 py-2"
                    style={{ animationDelay: `${i * 0.12}s` }}
                  >
                    <span className="min-w-0 flex-1 truncate text-small font-medium text-text-primary">
                      SKILL.md
                    </span>
                    <span className="shrink-0 text-micro text-text-muted">{v.when}</span>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-micro font-medium",
                        v.by === "agent"
                          ? "border-border-strong bg-bg-inset text-text-secondary"
                          : "border-border-default bg-surface-raised-1 text-text-secondary"
                      )}
                    >
                      {v.by === "agent" ? <Bot size={9} /> : <User size={9} />}
                      {v.by}
                    </span>
                  </div>
                ))}
              </aside>
            )}
          </div>
        </div>
      </div>
    </DemoShell>
  );
}

function SkillRow({ row }: { row: SkillRowData }) {
  const ScopeIcon =
    row.scope === "Private" ? Lock : row.scope === "Team" ? Users : Users;
  return (
    <div
      className={cn(
        "relative flex w-full flex-col gap-0.5 border-b border-border-subtle px-4 py-2 text-left",
        row.selected && "bg-surface-raised-3"
      )}
    >
      {row.selected && (
        <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-[3px] bg-text-primary" />
      )}
      <span className="flex w-full items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
          {row.name}
        </span>
        {row.draft && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-default bg-surface-raised-2 px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
            <span className="h-1 w-1 rounded-full bg-text-muted" />
            draft
          </span>
        )}
        <span className="shrink-0 text-micro text-text-muted">{row.date}</span>
      </span>
      <span className="flex w-full items-center gap-1.5 text-caption text-text-secondary">
        <ScopeIcon size={11} className="shrink-0 text-text-muted" />
        <span>{row.scope}</span>
        <span className="text-text-muted">·</span>
        <span className="min-w-0 truncate">{row.desc}</span>
      </span>
    </div>
  );
}
