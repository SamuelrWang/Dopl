"use client";

import {
  FileText,
  Mic,
  MoreHorizontal,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import type {
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeEntryType,
  PendingItem,
  SourceConnection,
} from "../data";
import { SourceIcon } from "./source-icon";

interface Props {
  kb: KnowledgeBase;
}

/**
 * Bento-style detail page for a single knowledge base. Hardcoded data
 * for now — the real implementation lands when the knowledge backend
 * slice ships. Layout cards (entries, add, pending, sources) match the
 * existing dopl chrome (oklch dark, white/[0.06] borders).
 *
 * Header treatment: thin PageTopBar with the KB name in normal text,
 * matching the sidebar's workspace-switcher row height. No giant H1,
 * no description, no status pills (per spec).
 */
export function KnowledgeBaseView({ kb }: Props) {
  return (
    <>
      <PageTopBar
        title={kb.name}
        trailing={
          <button
            type="button"
            aria-label="More"
            className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <MoreHorizontal size={13} className="text-text-secondary" />
          </button>
        }
      />
      <div className="container mx-auto max-w-7xl px-6 pt-[68px] pb-8 pointer-events-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 auto-rows-min">
          <EntriesCard
            entries={kb.entries}
            className="lg:col-span-2 lg:row-span-2"
          />
          <AddKnowledgeCard className="lg:col-span-1" />
          <PendingCard pending={kb.pending} className="lg:col-span-1" />
          <SourcesCard sources={kb.sources} className="lg:col-span-3" />
        </div>
      </div>
    </>
  );
}

// ── Card primitive ───────────────────────────────────────────────────

interface CardProps {
  title?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

function Card({ title, action, className, children }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/[0.06] p-4",
        className,
      )}
      style={{ backgroundColor: "oklch(0.13 0 0)" }}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-3">
          {title ? (
            <h2 className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/70">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Entries ──────────────────────────────────────────────────────────

const ENTRY_TYPE_LABEL: Record<KnowledgeEntryType, string> = {
  note: "Note",
  doc: "Doc",
  transcript: "Transcript",
  imported: "Import",
};

interface EntriesCardProps {
  entries: KnowledgeEntry[];
  className?: string;
}

function EntriesCard({ entries, className }: EntriesCardProps) {
  return (
    <Card
      title={`Entries · ${entries.length}`}
      action={
        <button
          type="button"
          className="text-[11px] text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
        >
          <FileText size={11} /> View all
        </button>
      }
      className={className}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {entries.map((e) => (
          <EntryTile key={e.id} entry={e} />
        ))}
      </div>
    </Card>
  );
}

function EntryTile({ entry }: { entry: KnowledgeEntry }) {
  return (
    <button
      type="button"
      className="text-left rounded-lg border border-white/[0.06] p-3 hover:bg-white/[0.04] hover:border-white/[0.1] transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[9px] font-mono uppercase tracking-wider text-text-secondary/60 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
          {ENTRY_TYPE_LABEL[entry.type]}
        </span>
        <span className="text-[10px] font-mono text-text-secondary/40">
          {entry.updatedAt}
        </span>
      </div>
      <p className="text-sm font-medium text-text-primary leading-snug">
        {entry.title}
      </p>
      <p className="mt-1 text-xs text-text-secondary line-clamp-2">
        {entry.excerpt}
      </p>
    </button>
  );
}

// ── Add knowledge ────────────────────────────────────────────────────

function AddKnowledgeCard({ className }: { className?: string }) {
  return (
    <Card
      title="Add knowledge"
      action={
        <span className="text-[11px] flex items-center gap-1 text-text-secondary/60">
          <Sparkles size={11} /> Auto-categorized
        </span>
      }
      className={className}
    >
      <textarea
        rows={5}
        placeholder="Drop a note, paste content, or describe what you want this knowledge base to learn…"
        className="w-full bg-transparent border border-white/[0.06] rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 resize-none focus:outline-none focus:border-white/[0.15] transition-colors"
      />
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.06] hover:bg-white/[0.04] transition-colors text-xs text-text-secondary cursor-pointer"
        >
          <Mic size={13} className="text-red-400" />
          Dictate
        </button>
        <button
          type="button"
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors cursor-pointer"
        >
          <Send size={13} />
          Add
        </button>
      </div>
    </Card>
  );
}

// ── Pending intake ───────────────────────────────────────────────────

interface PendingCardProps {
  pending: PendingItem[];
  className?: string;
}

function PendingCard({ pending, className }: PendingCardProps) {
  return (
    <Card
      title={`Pending intake · ${pending.length}`}
      action={
        <span className="text-[11px] text-text-secondary/60 font-mono uppercase tracking-wider">
          Unincorporated
        </span>
      }
      className={className}
    >
      <div className="flex flex-col gap-2.5">
        {pending.map((p) => (
          <div
            key={p.id}
            className="rounded-lg border border-white/[0.06] p-3 hover:border-white/[0.1] transition-colors"
          >
            <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
              {p.source}
            </p>
            <p className="mt-1 text-sm font-medium text-text-primary leading-snug">
              {p.title}
            </p>
            <p className="mt-1 text-xs text-text-secondary line-clamp-2">
              {p.preview}
            </p>
            <div className="mt-2.5 flex gap-1.5">
              <button
                type="button"
                className="text-[11px] px-2 py-1 rounded-md border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] transition-colors cursor-pointer text-text-primary"
              >
                Incorporate
              </button>
              <button
                type="button"
                className="text-[11px] px-2 py-1 rounded-md text-text-secondary/60 hover:text-text-secondary transition-colors cursor-pointer"
              >
                Discard
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Sources / Integrations ───────────────────────────────────────────

interface SourcesCardProps {
  sources: SourceConnection[];
  className?: string;
}

function SourcesCard({ sources, className }: SourcesCardProps) {
  return (
    <Card
      title="Sources"
      action={
        <button
          type="button"
          className="text-[11px] flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          <Plus size={11} /> Connect
        </button>
      }
      className={className}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {sources.map((s) => (
          <SourceRow key={s.provider} source={s} />
        ))}
      </div>
    </Card>
  );
}

function SourceRow({ source }: { source: SourceConnection }) {
  const connected = source.status === "connected";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5",
        connected
          ? "border-white/[0.1] bg-white/[0.02]"
          : "border-white/[0.05] opacity-60",
      )}
    >
      <SourceIcon provider={source.provider} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text-primary leading-tight truncate">
            {source.name}
          </p>
          {connected && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"
              aria-label="Connected"
            />
          )}
        </div>
        <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60 truncate">
          {connected ? source.meta ?? "Connected" : "Not connected"}
        </p>
      </div>
    </div>
  );
}
