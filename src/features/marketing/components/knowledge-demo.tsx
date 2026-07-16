"use client";

import {
  Archive,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  Folder,
  ListFilter,
  Lock,
  Pin,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { DemoShell, useDemoTimeline } from "./demo-shell";

/**
 * Animated miniature of the Knowledge page (knowledge-v2's two-pane
 * layout: 372px-ish base list with expandable file trees, document detail
 * pane with pill tabs). Scenario: an agent files a new doc into the right
 * folder and writes it while you watch.
 */

const MARKS = [1.6, 3.4, 5.6] as const;

const CAPTIONS = [
  "Team knowledge lives in shared bases",
  "Your agent files a new doc where it belongs",
  "…and writes it, citing what it did",
  "Ready for the next agent that needs it",
] as const;

const FILTERS = ["All", "Private", "Team", "Shared"] as const;

const OLD_DOC = {
  title: "Northwind — intro call",
  paras: [
    "Spoke with their ops lead about lab-scheduling pain. Current tooling is spreadsheets plus a nightly script someone maintains on the side.",
    "They want a pilot scoped to one lab. Follow-up owns the security questionnaire.",
  ],
};

const NEW_DOC = {
  title: "Vantage Health — discovery",
  paras: [
    "Discovery call with Vantage Health. Care-ops team is drowning in referral triage; agents currently copy-paste between three systems.",
    "Next step agreed: follow up Thursday with a scoped pilot outline. Logged on the Vantage Health object in Outreach.",
  ],
};

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary";

export function KnowledgeDemo({
  active = true,
  paused = false,
}: {
  active?: boolean;
  paused?: boolean;
}) {
  const step = useDemoTimeline(MARKS, active, paused);

  const showNew = step >= 1;
  const docOpen = step >= 2;
  const doc = docOpen ? NEW_DOC : OLD_DOC;
  const visibleParas = docOpen ? (step >= 3 ? 2 : 1) : 2;

  return (
    <DemoShell caption={CAPTIONS[step]}>
      <div className="page-float m-0 flex h-full w-full rounded-b-none border-b-0">
        {/* list pane */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-border-default">
          <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
            <span className="flex items-center gap-1 text-title font-semibold tracking-tight text-text-primary">
              Knowledge
              <ChevronDown size={14} className="text-text-muted" />
            </span>
            <span className="flex-1" />
            <span className={ICON_BTN}>
              <ListFilter size={15} />
            </span>
            <span className={ICON_BTN}>
              <Plus size={16} />
            </span>
          </div>
          <div className="concave-field mx-3.5 mb-3 flex h-8 items-center gap-2 rounded-[9px] px-2.5">
            <Search size={13} className="shrink-0 text-text-muted" />
            <span className="text-caption text-text-muted">Search knowledge</span>
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

          <div className="min-h-0 flex-1 overflow-hidden border-t border-border-default">
            {/* Outreach Playbook — expanded, holds the scenario */}
            <div className="border-b border-border-default">
              <KbRow
                name="Outreach Playbook"
                time="Today"
                scope="Workspace"
                desc="Calls, intros, objections"
                expanded
              />
              <div className="pb-1.5">
                <TreeRow depth={0} icon="folderOpen" label="Calls" chevronOpen />
                <TreeRow
                  depth={1}
                  icon="file"
                  label={OLD_DOC.title}
                  selected={!docOpen}
                />
                {showNew && (
                  <TreeRow
                    depth={1}
                    icon="file"
                    label={NEW_DOC.title}
                    selected={docOpen}
                    pop
                  />
                )}
                <TreeRow depth={0} icon="folder" label="Objections" />
              </div>
            </div>
            <div className="border-b border-border-default">
              <KbRow
                name="Engineering Handbook"
                time="Yesterday"
                scope="Workspace"
                desc="Standards, runbooks, decisions"
              />
            </div>
            <div className="border-b border-border-default">
              <KbRow name="Q3 Research Notes" time="2 Jul" scope="Private" />
            </div>
          </div>
        </div>

        {/* detail pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border-default px-3">
            <span className={ICON_BTN}>
              <X size={16} />
            </span>
            <span className="mx-1 h-[22px] w-px bg-border-strong" />
            <span className={ICON_BTN}>
              <ChevronLeft size={16} />
            </span>
            <span className={ICON_BTN}>
              <ChevronRight size={16} />
            </span>
            <span className="ml-1 flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-small font-medium text-text-secondary">
                Outreach Playbook
              </span>
              <ChevronRight size={12} className="shrink-0 text-text-muted" />
              <span className="shrink-0 text-small font-medium text-text-secondary">Calls</span>
              <ChevronRight size={12} className="shrink-0 text-text-muted" />
              <span className="min-w-0 truncate text-lead font-semibold text-text-primary">
                {doc.title}
              </span>
            </span>
            <span className="flex-1" />
            <span className={ICON_BTN}>
              <Download size={15} />
            </span>
            <span className={ICON_BTN}>
              <Settings size={15} />
            </span>
            <span className="mx-1 h-[22px] w-px bg-border-strong" />
            <span className={ICON_BTN}>
              <Pin size={15} />
            </span>
            <span className={ICON_BTN}>
              <Archive size={15} />
            </span>
          </div>
          <div className="flex items-center gap-1 border-b border-border-default px-6 py-2.5">
            {["Overview", "Messages", "Attachments"].map((t) => (
              <span
                key={t}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-small font-medium",
                  t === "Overview"
                    ? "concave-sel font-semibold text-text-primary"
                    : "text-text-secondary"
                )}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden px-10 pb-6 pt-7">
            <div key={doc.title} className="mx-auto max-w-[560px]">
              <div
                className={cn(
                  "text-display font-semibold tracking-tight text-text-primary",
                  docOpen && "lp-demo-row-in"
                )}
              >
                {doc.title}
              </div>
              <div className="mt-4 flex flex-col gap-3">
                {doc.paras.slice(0, visibleParas).map((p, i) => (
                  <p
                    key={p}
                    className={cn(
                      "text-lead leading-[1.625] text-text-primary/90",
                      docOpen && "lp-demo-row-in"
                    )}
                    style={docOpen ? { animationDelay: `${0.15 + i * 0.3}s` } : undefined}
                  >
                    {p}
                    {docOpen && i === visibleParas - 1 && step < 3 && (
                      <span className="lp-demo-caret" />
                    )}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DemoShell>
  );
}

function KbRow({
  name,
  time,
  scope,
  desc,
  expanded,
}: {
  name: string;
  time: string;
  scope: "Workspace" | "Private";
  desc?: string;
  expanded?: boolean;
}) {
  const ScopeIcon = scope === "Private" ? Lock : Building2;
  return (
    <div className="flex items-start gap-2.5 py-[9px] pl-3.5 pr-4">
      <ChevronRight
        size={14}
        className={cn("mt-0.5 shrink-0 text-text-muted", expanded && "rotate-90")}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-body font-semibold tracking-tight text-text-primary">
            {name}
          </span>
          <span className="shrink-0 text-micro text-text-muted">{time}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-caption text-text-secondary">
          <ScopeIcon size={11} className="shrink-0 text-text-muted" />
          <span>{scope}</span>
          {desc && (
            <>
              <span className="text-text-muted">·</span>
              <span className="min-w-0 truncate">{desc}</span>
            </>
          )}
        </span>
      </span>
    </div>
  );
}

function TreeRow({
  depth,
  icon,
  label,
  selected,
  chevronOpen,
  pop,
}: {
  depth: number;
  icon: "folder" | "folderOpen" | "file";
  label: string;
  selected?: boolean;
  chevronOpen?: boolean;
  pop?: boolean;
}) {
  const Icon = icon === "file" ? FileText : icon === "folderOpen" ? FolderOpen : Folder;
  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1.5 pr-4 text-small text-text-primary",
        selected && "bg-surface-raised-3",
        pop && "lp-demo-pop"
      )}
      style={{ paddingLeft: 28 + depth * 15 }}
    >
      {icon !== "file" ? (
        <ChevronRight
          size={12}
          className={cn("shrink-0 text-text-muted", chevronOpen && "rotate-90")}
        />
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <Icon size={14} className="shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  );
}
