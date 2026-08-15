"use client";

import { useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import {
  ArrowRight,
  Check,
  Copy,
  MousePointer2,
  SquareTerminal,
} from "lucide-react";

/**
 * Tab IS the command: selecting one swaps the terminal line (keyed on tab id
 * so React remounts and replays the fade). Add/reorder clients via TABS.
 */

/**
 * ⚠ NOT a subdomain — MCP route lives on the app origin; do not "tidy" into
 * mcp.usedopl.com. Same value the desktop derives at runtime
 * (`dopl-desktop-app/main/config.js` › `MCP_URL`), served by
 * `src/app/api/mcp/route.ts`.
 */
const MCP_URL = "https://www.usedopl.com/api/mcp";

type DevTab = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  command: string;
};


/** Currentcolor so active/ghost tab states tint it with the text. */
function ClaudeCodeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 12" width="15" height="12" className={className} aria-hidden>
      <g fill="currentColor">
        <rect x="1" y="0" width="2" height="2" />
        <rect x="13" y="0" width="2" height="2" />
        <rect x="0" y="3" width="16" height="6" rx="1" />
        <rect x="3" y="10" width="2" height="2" />
        <rect x="11" y="10" width="2" height="2" />
      </g>
      <g fill="var(--lp-dev-glyph-bg, #ffffff)">
        <rect x="4" y="5" width="2" height="2" />
        <rect x="10" y="5" width="2" height="2" />
      </g>
    </svg>
  );
}

function CodexGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 14" width="16" height="13" className={className} aria-hidden>
      <path
        d="M5.2 12.8h8a3.9 3.9 0 0 0 1.1-7.65A4.9 4.9 0 0 0 4.8 4.2a4.3 4.3 0 0 0 .4 8.6Z"
        fill="currentColor"
      />
      <path
        d="M6 6.2l2 1.9-2 1.9M9.6 10.4h2.6"
        stroke="var(--lp-dev-glyph-bg, #ffffff)"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

const TABS: readonly DevTab[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    icon: ClaudeCodeGlyph,
    command: `claude mcp add --transport http dopl ${MCP_URL} --scope user`,
  },
  {
    id: "codex",
    label: "Codex",
    icon: CodexGlyph,
    // Codex CLI: `--url` is the flag for a Streamable-HTTP (remote) server.
    command: `codex mcp add dopl --url ${MCP_URL}`,
  },
  {
    id: "cursor",
    label: "Cursor",
    icon: MousePointer2,
    // Not a CLI line on purpose: Cursor has no `cursor mcp add` verb — it's UI
    // or a ~/.cursor/mcp.json edit. Swap to a command if their CLI grows one.
    command: `"dopl": { "url": "${MCP_URL}" }`,
  },
  {
    id: "sdk",
    label: "SDK",
    icon: SquareTerminal,
    // ⚠ Will not resolve: packages/dopl-client/package.json is `private: true`,
    // unpublished. Publish or change this copy before the section goes live.
    command: "npm install @dopl/client",
  },
];

export function DevelopersSection() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tab = TABS[active];

  function select(next: number) {
    setActive(next);
    // Stale "Copied" under a command you didn't copy is a lie.
    setCopied(false);
  }

  /** Roving tabindex: only the selected tab is tabbable, arrows move between. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;

    event.preventDefault();
    const next = (active + step + TABS.length) % TABS.length;
    select(next);
    tabRefs.current[next]?.focus();
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(tab.command);
    } catch {
      // Blocked (insecure origin, denied permission) — never claim a copy
      // that didn't happen.
      return;
    }
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 600);
  }

  return (
    <section className="lp-dev">
      <div className="lp-dev-inner">
        <p className="lp-dev-eyebrow">Developers</p>
        <h2 className="lp-dev-heading">Connect your agent via MCP, SDK, or CLI</h2>

        <div className="lp-dev-band">
          {/* One glass panel for tabs + terminal. Static box, so
              backdrop-filter is safe here. */}
          <LiquidGlass radius={18} className="lp-dev-glass">
              <div className="lp-dev-glass-pad">
          <div
            className="lp-dev-tabs"
            role="tablist"
            aria-label="Ways to connect"
            onKeyDown={onKeyDown}
          >
            {TABS.map((item, i) => {
              const selected = i === active;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  id={`lp-dev-tab-${item.id}`}
                  ref={(node) => {
                    tabRefs.current[i] = node;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="lp-dev-panel"
                  tabIndex={selected ? 0 : -1}
                  className="lp-dev-tab"
                  data-active={selected}
                  onClick={() => select(i)}
                >
                  <Icon className="lp-dev-tab-icon" size={15} strokeWidth={1.9} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="lp-dev-term">
            <div className="lp-dev-term-bar">
              <span className="lp-dev-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <button
                type="button"
                className="lp-dev-copy"
                data-copied={copied}
                onClick={onCopy}
              >
                <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
                {copied ? (
                  <Check size={14} strokeWidth={2} aria-hidden />
                ) : (
                  <Copy size={14} strokeWidth={1.8} aria-hidden />
                )}
              </button>
            </div>

            <div
              key={tab.id}
              id="lp-dev-panel"
              role="tabpanel"
              aria-labelledby={`lp-dev-tab-${tab.id}`}
              className="lp-dev-term-body"
            >
              <span className="lp-dev-prompt" aria-hidden>
                &rsaquo;
              </span>
              <code className="lp-dev-cmd">{tab.command}</code>
            </div>
          </div>
              </div>
            </LiquidGlass>
        </div>

        <div className="lp-dev-cta">
          {/* TODO: `/playground` route doesn't exist yet — placeholder,
              must not navigate. */}
          <a href="#" className="lp-btn lp-btn--sm lp-btn--3d">
            Try in playground
            <ArrowRight size={14} strokeWidth={2} aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}
