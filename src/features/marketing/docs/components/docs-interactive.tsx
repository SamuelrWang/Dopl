"use client";

import { Check, ChevronDown, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";
import { CopyButton } from "@/shared/ui/copy-button";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { SendButton } from "@/shared/ui/send-button";

import type { CodeTab } from "../content/types";

/** The DOM id of the floating ask input — the header's "Ask Assistant ⌘I" focuses it. */
export const ASK_INPUT_ID = "docs-ask";

/** Hands a question to Claude with the docs index as context. The docs have no assistant
 *  backend of their own yet. */
function openInClaude(prompt: string) {
  window.open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`, "_blank", "noopener");
}

/** Tabbed code block — label row with the active tab underlined, copy on the right. */
export function CodeGroup({ tabs }: { tabs: CodeTab[] }) {
  const [active, setActive] = useState(0);
  const current = tabs[active] ?? tabs[0];
  return (
    <div className="docs-code">
      <div className="docs-code-head">
        <div className="docs-code-tabs" role="tablist">
          {tabs.map((t, i) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={i === active}
              className="docs-code-tab"
              data-active={i === active || undefined}
              onClick={() => setActive(i)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <CopyButton text={current.code} size={14} label="Copy code" />
      </div>
      <pre className="docs-code-body">
        <code>{current.code}</code>
      </pre>
    </div>
  );
}

/** Underlined tab strip ("Everyday use / For developers"); panels are rendered by the server. */
export function DocsTabs({ labels, panels }: { labels: string[]; panels: ReactNode[] }) {
  const [active, setActive] = useState(0);
  return (
    <div className="docs-tabs">
      <ul className="docs-tabs-list" role="tablist">
        {labels.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              role="tab"
              aria-selected={i === active}
              data-active={i === active || undefined}
              className="docs-tabs-tab"
              onClick={() => setActive(i)}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
      <div role="tabpanel">{panels[active]}</div>
    </div>
  );
}

/** "Copy" split button beside the H1: copies the page as Markdown; the chevron opens more. */
export function CopyPageButton({ markdown, url }: { markdown: string; url: string }) {
  const { copied, copy } = useCopyToClipboard();
  const [open, setOpen] = useState(false);
  const ask = `Read ${url} so I can ask questions about it.`;
  return (
    <div className="docs-copy relative">
      <div className="docs-copy-group auth-btn-3d-light">
        <button type="button" className="docs-copy-main" onClick={() => void copy(markdown)}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>Copy</span>
        </button>
        <button
          type="button"
          className="docs-copy-more"
          aria-label="More copy options"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      <Popover open={open} onClose={() => setOpen(false)} align="right" className="w-[220px]">
        <MenuItem
          description="Copy this page as Markdown"
          onSelect={() => {
            void copy(markdown);
            setOpen(false);
          }}
        >
          Copy page
        </MenuItem>
        <MenuItem
          description="Ask questions about this page"
          onSelect={() => {
            openInClaude(ask);
            setOpen(false);
          }}
        >
          Open in Claude
        </MenuItem>
        <MenuItem
          description="Ask questions about this page"
          onSelect={() => {
            window.open(`https://chatgpt.com/?q=${encodeURIComponent(ask)}`, "_blank", "noopener");
            setOpen(false);
          }}
        >
          Open in ChatGPT
        </MenuItem>
      </Popover>
    </div>
  );
}

/** "Was this page helpful?  Yes  No" — records the vote for this visit only. */
export function PageFeedback() {
  const [vote, setVote] = useState<"yes" | "no" | null>(null);
  return (
    <div className="docs-feedback">
      <p>{vote ? "Thanks for the feedback" : "Was this page helpful?"}</p>
      <div className="docs-feedback-buttons">
        <button
          type="button"
          className="docs-feedback-btn auth-btn-3d-light"
          aria-pressed={vote === "yes"}
          onClick={() => setVote("yes")}
        >
          <ThumbsUp size={14} />
          Yes
        </button>
        <button
          type="button"
          className="docs-feedback-btn auth-btn-3d-light"
          aria-pressed={vote === "no"}
          onClick={() => setVote("no")}
        >
          <ThumbsDown size={14} />
          No
        </button>
      </div>
    </div>
  );
}

/** The "Ask a question…" input pinned to the bottom of the main column. */
export function AskBar() {
  const [text, setText] = useState("");
  const submit = () => {
    const q = text.trim();
    if (!q) return;
    openInClaude(`Using the Dopl docs at https://www.usedopl.com/llms.txt, answer: ${q}`);
    setText("");
  };
  return (
    <div className="docs-ask">
      <form
        className="docs-ask-box"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          id={ASK_INPUT_ID}
          value={text}
          rows={2}
          placeholder="Ask a question..."
          aria-label="Ask a question"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <SendButton className="docs-ask-send" disabled={!text.trim()} onClick={submit} />
      </form>
    </div>
  );
}
