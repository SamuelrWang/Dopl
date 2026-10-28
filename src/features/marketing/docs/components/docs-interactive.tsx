"use client";

import { Check, Copy, FileText } from "lucide-react";
import { useState, type ReactNode } from "react";

import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";

import { CONNECT_TABS } from "../content/connect";
import type { CodeTab } from "../content/types";

/**
 * The docs' interactive pieces, on the landing sections' recipe BY CLASS NAME
 * (`marketing.css`): the white window with gray dots and a plain "Copy" text button is
 * `.lp-connect-term` / `-term-bar` / `.lp-connect-dots` / `.lp-connect-copy`; the connect
 * tabs over the photo are `.lp-connect-band` / `.lp-connect-tab` inside `LiquidGlass`.
 */

/** Hands a question to Claude. The docs have no assistant backend of their own yet. */
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
 * "Connect an agent": the landing Connect section's glass-over-photo band, tabs and terminal
 * (`.lp-connect-*`), sized for the docs column. Static — no scroll scrub here.
 */
export function DocsConnect() {
  const [active, setActive] = useState(0);
  const tab = CONNECT_TABS[active];
  return (
    <div className="lp-connect-band docs-connect-band">
      <div className="lp-connect-glass-box docs-connect-glass-box">
        <LiquidGlass radius={18} className="lp-connect-glass" edge="rim">
          <div className="lp-connect-glass-pad">
            <div className="lp-connect-tabs" role="tablist" aria-label="Ways to connect">
              {CONNECT_TABS.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  className="lp-connect-tab"
                  data-active={i === active}
                  onClick={() => setActive(i)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="lp-connect-term">
              <div className="lp-connect-term-bar">
                <span className="lp-connect-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <CopyText text={tab.command} />
              </div>
              <div key={tab.id} role="tabpanel" className="lp-connect-term-body docs-connect-body">
                <span className="lp-connect-prompt" aria-hidden>
                  &rsaquo;
                </span>
                <code className="lp-connect-cmd">{tab.command}</code>
              </div>
            </div>
            <div key={`${tab.id}-hint`} className="lp-connect-hint docs-connect-hint">
              {tab.hint && <span>{tab.hint}</span>}
            </div>
          </div>
        </LiquidGlass>
      </div>
    </div>
  );
}

/** The small icon button beside the H1: copy the page as Markdown, or open it in an assistant. */
export function CopyPageButton({ markdown, url }: { markdown: string; url: string }) {
  const { copied, copy } = useCopyToClipboard();
  const [open, setOpen] = useState(false);
  const ask = `Read ${url} so I can ask questions about it.`;
  return (
    <div className="docs-copy relative">
      <button
        type="button"
        className="docs-copy-btn"
        aria-label="Copy page"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {copied ? (
          <Check size={16} strokeWidth={2} aria-hidden />
        ) : (
          <FileText size={16} strokeWidth={1.8} aria-hidden />
        )}
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
