"use client";

import { useState } from "react";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
  FolderGit2,
  Lightbulb,
  UploadCloud,
} from "lucide-react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import type { Conversation } from "../types";
import { FORMAT_LABELS, SOURCE_LABELS } from "../constants";
import { formatDate } from "../format";

/**
 * The chat's header box: title, agent-written overview, and a compact
 * meta line up top; the agent-filled detail (session metadata, what was
 * done, learnings) stacked below as collapsed disclosure strips inside
 * the same card.
 */
export function HeaderCard({ conversation }: { conversation: Conversation }) {
  const done = conversation.deliverables.filter((d) => d.done).length;

  return (
    <section className="overflow-hidden rounded-[14px] border border-border-strong bg-bg-elevated">
      <div className="px-5 pb-4 pt-4">
        <h2 className="text-display font-semibold tracking-tight text-text-primary">
          {conversation.title}
        </h2>
        <p className="mt-1.5 text-lead leading-relaxed text-text-secondary">
          {conversation.overview}
        </p>
        <p className="mt-2.5 text-caption text-text-muted">
          {formatDate(conversation.sessionDate)} ·{" "}
          {SOURCE_LABELS[conversation.source]}
          {conversation.project && <> · {conversation.project}</>} ·{" "}
          {conversation.messages.length} messages ·{" "}
          {FORMAT_LABELS[conversation.format]}
        </p>
      </div>

      <Disclosure label="Session details">
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <MetaRow icon={CalendarDays} label="Session date">
            {formatDate(conversation.sessionDate)}
          </MetaRow>
          <MetaRow icon={Bot} label="Source agent">
            {SOURCE_LABELS[conversation.source]}
          </MetaRow>
          {conversation.project && (
            <MetaRow icon={FolderGit2} label="Project">
              {conversation.project}
            </MetaRow>
          )}
          <MetaRow icon={UploadCloud} label="Exported">
            {formatDate(conversation.exportedAt)}
          </MetaRow>
          <MetaRow icon={FileText} label="Format">
            {FORMAT_LABELS[conversation.format]}
          </MetaRow>
        </div>
      </Disclosure>

      <Disclosure
        label="What was done"
        meta={`${done}/${conversation.deliverables.length}`}
      >
        <ul className="divide-y divide-border-subtle">
          {conversation.deliverables.map((d) => (
            <li
              key={d.label}
              className="flex items-center gap-3 px-4 py-2.5 text-body text-text-primary"
            >
              {d.done ? (
                <CheckCircle2 size={14} className="shrink-0 text-text-primary" />
              ) : (
                <Circle size={14} className="shrink-0 text-text-disabled" />
              )}
              <span className="min-w-0 flex-1">{d.label}</span>
            </li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure
        label="Memories & learnings"
        meta={String(conversation.learnings.length)}
      >
        <ul className="divide-y divide-border-subtle">
          {conversation.learnings.map((learning) => (
            <li
              key={learning}
              className="flex items-start gap-2.5 px-4 py-2.5 text-body leading-relaxed text-text-primary"
            >
              <Lightbulb size={13} className="mt-0.5 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">{learning}</span>
            </li>
          ))}
        </ul>
      </Disclosure>
    </section>
  );
}

function Disclosure({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-card-surface-subtle px-4 py-1.5 text-left transition-colors hover:bg-surface-raised-1"
      >
        <ChevronRight
          size={11}
          className={cn(
            "shrink-0 text-text-muted transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          {label}
        </span>
        {meta && <span className="text-caption text-text-muted">{meta}</span>}
        <span className="flex-1" />
      </button>
      {open && <div className={SECTION_BOX_INSET}>{children}</div>}
    </div>
  );
}

function MetaRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center text-body">
      <span className="flex w-40 shrink-0 items-center gap-2.5 text-text-secondary">
        <Icon size={13} className="text-text-muted" />
        {label}
      </span>
      <span className="min-w-0 font-medium text-text-primary">{children}</span>
    </div>
  );
}
