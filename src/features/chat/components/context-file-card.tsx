"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Download, FileText } from "lucide-react";
import { MarkdownMessage } from "@/shared/design";

interface ContextFileCardProps {
  title: string;
  markdown: string;
  promotedPanelId?: string;
  onPromote?: (input: { title: string; markdown: string }) => Promise<string | void>;
}

/**
 * Inline card rendered in the private chat when the model emits a
 * `context_file_artifact`. Curated markdown bundle the user can copy,
 * download, or promote to a workspace-shared artifact canvas panel.
 */
export function ContextFileCard({
  title,
  markdown,
  promotedPanelId,
  onPromote,
}: ContextFileCardProps) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [localPromotedId, setLocalPromotedId] = useState<string | null>(null);
  const promoted = promotedPanelId || localPromotedId;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — user can select-all manually
    }
  }

  function handleDownload() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = title.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
    a.download = `${safeName || "context"}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handlePromote() {
    if (!onPromote || promoting || promoted) return;
    setPromoting(true);
    try {
      const newId = await onPromote({ title, markdown });
      if (typeof newId === "string") setLocalPromotedId(newId);
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.04] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
      >
        <FileText size={12} className="text-cyan-300/80 shrink-0" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-300/80 shrink-0">
          Context file
        </span>
        <span className="text-[12.5px] font-medium text-text-primary truncate">
          {title}
        </span>
        <span className="ml-auto shrink-0 text-text-secondary/50">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {open && (
        <>
          <div className="px-3 py-3 max-h-[360px] overflow-y-auto border-t border-white/[0.06] text-[12.5px]">
            <MarkdownMessage content={markdown} />
          </div>
          <div className="flex items-center gap-2 px-2 py-2 border-t border-white/[0.06] bg-white/[0.02]">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11.5px] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors cursor-pointer"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11.5px] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors cursor-pointer"
            >
              <Download size={12} /> Download .md
            </button>
            {onPromote && (
              <button
                type="button"
                onClick={handlePromote}
                disabled={promoting || Boolean(promoted)}
                className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded text-[11.5px] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {promoted ? (
                  <>
                    <Check size={12} /> On canvas
                  </>
                ) : promoting ? (
                  "Promoting…"
                ) : (
                  "Promote to canvas"
                )}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
