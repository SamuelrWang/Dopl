"use client";

import {
  Bot,
  CalendarDays,
  CheckCircle2,
  Circle,
  FileText,
  FolderGit2,
  Lightbulb,
  UploadCloud,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SectionBox } from "@/shared/ui/section-box";
import type { Conversation } from "../types";
import { FORMAT_LABELS, SOURCE_LABELS } from "../constants";
import { formatDate } from "../format";

interface Props {
  conversation: Conversation;
}

/**
 * The agent-filled session header: metadata, what was done, and the
 * memories/learnings the agent chose to keep — three SectionBox cards
 * in the study-notes intro-panel language.
 */
export function SessionSections({ conversation }: Props) {
  const done = conversation.deliverables.filter((d) => d.done).length;

  return (
    <div className="flex flex-col gap-4">
      <SectionBox label="Session" resizable={false}>
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
      </SectionBox>

      <SectionBox
        label="What was done"
        meta={`${done}/${conversation.deliverables.length}`}
        resizable={false}
      >
        <ul className="divide-y divide-border-subtle">
          {conversation.deliverables.map((d) => (
            <li
              key={d.label}
              className="flex items-center gap-3 px-4 py-2.5 text-lead text-text-primary"
            >
              {d.done ? (
                <CheckCircle2 size={15} className="shrink-0 text-text-primary" />
              ) : (
                <Circle size={15} className="shrink-0 text-text-disabled" />
              )}
              <span className="min-w-0 flex-1">{d.label}</span>
            </li>
          ))}
        </ul>
      </SectionBox>

      <SectionBox
        label="Memories & learnings"
        meta={String(conversation.learnings.length)}
        resizable={false}
      >
        <ul className="divide-y divide-border-subtle">
          {conversation.learnings.map((learning) => (
            <li
              key={learning}
              className="flex items-start gap-2.5 px-4 py-2.5 text-lead leading-relaxed text-text-primary"
            >
              <Lightbulb size={14} className="mt-1 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">{learning}</span>
            </li>
          ))}
        </ul>
      </SectionBox>
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
  children: React.ReactNode;
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
