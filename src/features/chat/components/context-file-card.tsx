"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Download, FileText } from "lucide-react";
import { MarkdownMessage } from "@/shared/design";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";

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
 *
 * Header label is the generic "Artifact" — the kind (context file vs.
 * agent prompt) is implicit in the styling. Promoting to canvas asks
 * for explicit confirmation since it makes the artifact public to
 * every workspace member.
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const promoted = promotedPanelId || localPromotedId;
  const displayTitle = stripArtifactWord(title);

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
    const safeName = displayTitle.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
    a.download = `${safeName || "context"}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleConfirmPromote() {
    if (!onPromote || promoting || promoted) return;
    setConfirmOpen(false);
    setPromoting(true);
    try {
      const newId = await onPromote({ title: displayTitle, markdown });
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
          Artifact
        </span>
        <span className="text-[12.5px] font-medium text-text-primary truncate">
          {displayTitle}
        </span>
        <span className="ml-auto shrink-0 text-text-secondary/50">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
        aria-hidden={!open}
      >
        <div className="overflow-hidden min-h-0">
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
                onClick={() => {
                  if (!promoting && !promoted) setConfirmOpen(true);
                }}
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
        </div>
      </div>
      {confirmOpen && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirmOpen(false); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Promote artifact to canvas?</DialogTitle>
              <DialogDescription>
                Promoting puts this artifact on the workspace canvas, where
                every member of the workspace can see and open it. Until
                you promote, only you can see it in this private chat.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmPromote}>
                Promote to canvas
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Drop the literal word "Artifact" from a model-generated title — the
 *  card already shows an "Artifact" label, so repeating the word in the
 *  title is noise (e.g., "Sample Context File Artifact" → "Sample Context File"). */
function stripArtifactWord(title: string): string {
  return title.replace(/\bartifacts?\b/gi, "").replace(/\s+/g, " ").trim() || title;
}
