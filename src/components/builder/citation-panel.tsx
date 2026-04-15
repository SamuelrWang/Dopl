"use client";

import { useEffect, useRef, useState } from "react";
import { X, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownMessage } from "@/components/design";
import type { EntryReference } from "./builder-message";

interface CitationPanelProps {
  entry: EntryReference | null;
  /** Full entry details fetched from the API */
  details: CitationDetails | null;
  loading: boolean;
  onClose: () => void;
}

export interface CitationDetails {
  id: string;
  title: string | null;
  summary: string | null;
  source_url: string;
  source_platform: string;
  complexity: string | null;
  use_case: string | null;
  readme: string | null;
  agents_md: string | null;
  manifest: Record<string, unknown> | null;
  tags: Array<{ tag_type: string; tag_value: string }>;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-white/[0.08]">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full py-3 text-left text-xs font-mono uppercase tracking-wide text-white/50 hover:text-white/70 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" />
        )}
        {title}
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}

export function CitationPanel({ entry, details, loading, onClose }: CitationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (!entry) return null;

  const manifest = details?.manifest as {
    tools?: Array<{ name: string; role: string }>;
    integrations?: Array<{ from: string; to: string; method: string }>;
    patterns?: string[];
  } | null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-200"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          "fixed top-0 right-0 h-full w-[420px] max-w-[90vw] z-50",
          "bg-[#0a0a0f]",
          "border-l border-white/[0.12]",
          "shadow-[-8px_0_32px_rgba(0,0,0,0.3)]",
          "flex flex-col",
          "animate-in slide-in-from-right duration-200"
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 pb-4 border-b border-white/[0.08]">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white/90 leading-tight">
              {details?.title || entry.title || "Source"}
            </h3>
            {details?.source_url && (
              <a
                href={details.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-mono text-white/40 hover:text-white/60 transition-colors truncate max-w-full"
              >
                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{details.source_url}</span>
              </a>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-white/40 hover:text-white/70 hover:bg-white/[0.08] transition-all shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-1">
          {loading && (
            <div className="flex items-center gap-2 text-white/40 text-xs font-mono">
              <span className="inline-block w-1.5 h-1.5 bg-blue-400 animate-pulse" />
              Loading details...
            </div>
          )}

          {!loading && details && (
            <>
              {/* Summary */}
              {details.summary && (
                <p className="text-sm text-white/70 leading-relaxed mb-4">
                  {details.summary}
                </p>
              )}

              {/* Metadata pills */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {details.complexity && (
                  <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-[10px] font-mono uppercase tracking-wide text-white/50">
                    {details.complexity}
                  </span>
                )}
                {details.use_case && (
                  <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-[10px] font-mono uppercase tracking-wide text-white/50">
                    {details.use_case}
                  </span>
                )}
                {details.source_platform && (
                  <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-[10px] font-mono uppercase tracking-wide text-white/50">
                    {details.source_platform}
                  </span>
                )}
              </div>

              {/* Tools */}
              {manifest?.tools && manifest.tools.length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] font-mono uppercase tracking-wide text-white/40 mb-2">
                    Tools
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {manifest.tools.map((t, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-400/20 text-[10px] font-mono text-blue-300/70"
                        title={t.role}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Integrations */}
              {manifest?.integrations && manifest.integrations.length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] font-mono uppercase tracking-wide text-white/40 mb-2">
                    Integrations
                  </div>
                  <div className="space-y-1">
                    {manifest.integrations.map((intg, i) => (
                      <div
                        key={i}
                        className="text-xs text-white/50 font-mono"
                      >
                        {intg.from} → {intg.to}
                        <span className="text-white/30 ml-1">({intg.method})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tags */}
              {details.tags.length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] font-mono uppercase tracking-wide text-white/40 mb-2">
                    Tags
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {details.tags.map((t, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 rounded bg-white/[0.04] text-[10px] text-white/40"
                      >
                        {t.tag_value}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* README */}
              {details.readme && (
                <CollapsibleSection title="Implementation Guide" defaultOpen>
                  <div className="text-sm">
                    <MarkdownMessage content={details.readme} />
                  </div>
                </CollapsibleSection>
              )}

              {/* agents.md */}
              {details.agents_md && (
                <CollapsibleSection title="Setup Instructions">
                  <div className="text-sm">
                    <MarkdownMessage content={details.agents_md} />
                  </div>
                </CollapsibleSection>
              )}
            </>
          )}

          {!loading && !details && (
            <p className="text-sm text-white/40">
              Could not load entry details.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
