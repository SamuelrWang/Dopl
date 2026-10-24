"use client";

import { ArrowUp, Check, ChevronDown, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";

import { CONNECT_ROWS, CURSOR_INSTALL_URL } from "../content/connect";
import type { CodeTab } from "../content/types";

/**
 * The docs' interactive pieces, on the landing sections' recipe BY CLASS NAME
 * (`marketing.css`): the white window with gray dots and a plain "Copy" text button is
 * `.lp-connect-term` / `-term-bar` / `.lp-connect-dots` / `.lp-connect-copy` (the window
 * marketing.css keeps as SHARED). Anything the landing may rewrite is copied into docs.css.
 */

/** The DOM id of the floating ask input — the header's "Ask Assistant ⌘I" focuses it. */
export const ASK_INPUT_ID = "docs-ask";

/** Hands a question to Claude with the docs index as context. The docs have no assistant
 *  backend of their own yet. */
function openInClaude(prompt: string) {
  window.open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`, "_blank", "noopener");
}

/** The landing's plain "Copy" text button (`.lp-connect-copy`). */
function CopyText({ text }: { text: string }) {
  const { copied, copy } = useCopyToClipboard(600);
  return (
    <button type="button" className="lp-connect-copy" data-copied={copied} onClick={() => void copy(text)}>
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      {copied ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={1.8} aria-hidden />}
    </button>
  );
}

/** A white window: gray dots, optional text tabs, Copy, then the body. */
function Window({
  tabs,
  active,
  onSelect,
  copyText,
  children,
}: {
  tabs?: string[];
  active?: number;
  onSelect?: (i: number) => void;
  copyText: string;
  children: ReactNode;
}) {
  return (
    <div className="lp-connect-term docs-window">
      <div className="lp-connect-term-bar">
        <span className="docs-window-left">
          <span className="lp-connect-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          {tabs && tabs.length > 1 && (
            <span className="docs-window-tabs" role="tablist">
              {tabs.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  data-active={i === active || undefined}
                  className="docs-window-tab"
                  onClick={() => onSelect?.(i)}
                >
                  {label}
                </button>
              ))}
            </span>
          )}
        </span>
        <CopyText text={copyText} />
      </div>
      {children}
    </div>
  );
}

/** Code in a white window; several tabs switch the body. */
export function CodeGroup({ tabs }: { tabs: CodeTab[] }) {
  const [active, setActive] = useState(0);
  const current = tabs[active] ?? tabs[0];
  return (
    <Window tabs={tabs.map((t) => t.label)} active={active} onSelect={setActive} copyText={current.code}>
      <pre className="docs-window-body">
        <code className="lp-connect-cmd">{current.code}</code>
      </pre>
    </Window>
  );
}

/** "Copy this instruction into your agent" — the instruction in a white window. */
export function PromptWindow({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Window copyText={text}>
      <div className="docs-window-body docs-window-prose">{children}</div>
    </Window>
  );
}

/**
 * "Connect an agent": the landing Connect section's `dopl-mcp` code window (connect-section.tsx),
 * on the shared `.lp-connect-term` window. The row/comment/copy rules are docs-prefixed copies in
 * docs.css, so a landing rewrite cannot break this block again.
 */
export function DocsConnect() {
  return (
    <div className="lp-connect-term docs-window docs-mcp">
      <div className="lp-connect-term-bar">
        <span className="lp-connect-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="docs-mcp-file">dopl-mcp</span>
      </div>
      <div className="docs-mcp-code">
        {CONNECT_ROWS.map((row) => (
          <div key={row.id} className="docs-mcp-block">
            <code className="docs-mcp-comment"># {row.comment}</code>
            <div className="docs-mcp-row">
              <code className="docs-mcp-cmd">
                {row.value.map((tok, i) => (
                  <span key={i} className={tok.k ? "docs-mcp-str" : undefined}>
                    {tok.t}
                  </span>
                ))}
              </code>
              <CopyIcon text={row.copy} label={row.label} />
            </div>
          </div>
        ))}
        <code className="docs-mcp-comment">
          # Cursor:{" "}
          <a href={CURSOR_INSTALL_URL} className="docs-mcp-install">
            one-click install
          </a>
        </code>
      </div>
    </div>
  );
}

/** The landing connect window's per-line copy: icon only, "Copied" while it holds. */
function CopyIcon({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopyToClipboard(900);
  return (
    <button
      type="button"
      className="lp-connect-copy"
      data-copied={copied}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={() => void copy(text)}
    >
      {copied && <span aria-live="polite">Copied</span>}
      {copied ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={1.8} aria-hidden />}
    </button>
  );
}

/** "Copy" beside the H1, as the landing's plain text button; the chevron opens more. */
export function CopyPageButton({ markdown, url }: { markdown: string; url: string }) {
  const { copied, copy } = useCopyToClipboard();
  const [open, setOpen] = useState(false);
  const ask = `Read ${url} so I can ask questions about it.`;
  return (
    <div className="docs-copy relative">
      <button type="button" className="lp-connect-copy" data-copied={copied} onClick={() => void copy(markdown)}>
        {copied ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={1.8} aria-hidden />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <button
        type="button"
        className="lp-connect-copy"
        aria-label="More copy options"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown size={14} aria-hidden />
      </button>
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

/** "Was this page helpful?  Yes  No" — the landing's light pill buttons. */
export function PageFeedback() {
  const [vote, setVote] = useState<"yes" | "no" | null>(null);
  return (
    <div className="docs-feedback">
      <p>{vote ? "Thanks for the feedback" : "Was this page helpful?"}</p>
      <div className="docs-feedback-buttons">
        {(["yes", "no"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="lp-btn lp-btn--3d-light docs-feedback-btn"
            aria-pressed={vote === v}
            onClick={() => setVote(v)}
          >
            {v === "yes" ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The "Ask a question…" pill pinned to the bottom of the main column: the landing's
 *  "Direct at any depth" composer (ontology-command.tsx › `.lp-ont-composer`), as a real field. */
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
        className="docs-ask-pill"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          id={ASK_INPUT_ID}
          type="text"
          value={text}
          placeholder="Ask a question..."
          aria-label="Ask a question"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="docs-ask-send" aria-label="Send" disabled={!text.trim()}>
          <ArrowUp size={16} strokeWidth={2.5} aria-hidden />
        </button>
      </form>
    </div>
  );
}
