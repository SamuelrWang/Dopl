"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Send } from "lucide-react";

interface AgentPromptCardProps {
  title: string;
  prompt: string;
  /** When set, the card shows "On canvas" instead of the promote button. */
  promotedPanelId?: string;
  /**
   * Promote-to-canvas handler. Receives the title + prompt body so the
   * caller can construct an artifact panel. Should return the new
   * panel id so the card can flip to its promoted state.
   */
  onPromote?: (input: { title: string; markdown: string }) => Promise<string | void>;
}

/**
 * Inline card rendered in the private chat when the model emits an
 * `agent_prompt_artifact`. The user copies the prompt into their
 * executing agent (Claude Code, Cursor, etc.); the canvas surface here
 * is intentionally NOT a chat target — that's why the promote button
 * goes to a static artifact panel rather than spawning a canvas chat.
 */
export function AgentPromptCard({
  title,
  prompt,
  promotedPanelId,
  onPromote,
}: AgentPromptCardProps) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [localPromotedId, setLocalPromotedId] = useState<string | null>(null);
  const promoted = promotedPanelId || localPromotedId;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — silently noop. The user can select the text manually.
    }
  }

  async function handlePromote() {
    if (!onPromote || promoting || promoted) return;
    setPromoting(true);
    try {
      const markdown = `# ${title}\n\n${prompt}`;
      const newId = await onPromote({ title, markdown });
      if (typeof newId === "string") setLocalPromotedId(newId);
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="rounded-lg border border-violet-300/20 bg-violet-300/[0.04] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
      >
        <Send size={12} className="text-violet-300/80 shrink-0" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-violet-300/80 shrink-0">
          Agent prompt
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
          <pre className="px-3 py-3 max-h-[280px] overflow-y-auto text-[12px] leading-relaxed text-text-primary/90 whitespace-pre-wrap font-mono border-t border-white/[0.06]">
            {prompt}
          </pre>
          <div className="flex items-center gap-2 px-2 py-2 border-t border-white/[0.06] bg-white/[0.02]">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11.5px] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors cursor-pointer"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy prompt"}
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
