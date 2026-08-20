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
import { ScrollReveal } from "./scroll-reveal";
import { useGlassScrub } from "./use-glass-scrub";

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

/**
 * Cursor's official one-click install link: base64 of the mcp.json server
 * body. Verified current 2026-08-17 (cursor.com/docs/context/mcp/install-links;
 * the https variant is the one GitHub's own install button uses). Config is
 * `{"url": MCP_URL}` — regenerate the constant if MCP_URL ever changes:
 * `node -e 'console.log(Buffer.from(JSON.stringify({url:"<MCP_URL>"})).toString("base64"))'`
 */
const CURSOR_INSTALL_URL = `https://cursor.com/en/install-mcp?name=dopl&config=${encodeURIComponent(
  "eyJ1cmwiOiJodHRwczovL3d3dy51c2Vkb3BsLmNvbS9hcGkvbWNwIn0=",
)}`;

type DevTab = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  command: string;
  /** Short line under the terminal: where the command goes / what it covers. */
  hint?: string;
  /** Optional one-click install link rendered beside the hint. */
  install?: { label: string; href: string };
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
      <g fill="var(--lp-connect-glyph-bg, #ffffff)">
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
        stroke="var(--lp-connect-glyph-bg, #ffffff)"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Per-product tabs, each showing that product's LOWEST-FRICTION path for a
 * nontechnical user (research verified 2026-08-17 against official docs):
 * Claude = the connector URL (account-synced: one add covers claude.ai,
 * Desktop AND Claude Code — preferred over the CLI command for that reason);
 * Codex = one command shared by CLI, IDE extension and the ChatGPT desktop
 * app (same ~/.codex/config.toml); Cursor = the official one-click install
 * link, mcp.json snippet as fallback.
 */
const TABS: readonly DevTab[] = [
  {
    id: "claude",
    label: "Claude",
    icon: ClaudeCodeGlyph,
    command: MCP_URL,
    hint: "Paste in Settings → Connectors → Add custom connector — syncs to claude.ai, Desktop, and Claude Code.",
  },
  {
    id: "codex",
    label: "Codex",
    icon: CodexGlyph,
    // Codex CLI: `--url` is the flag for a Streamable-HTTP (remote) server.
    command: `codex mcp add dopl --url ${MCP_URL}`,
    hint: "One command covers the Codex CLI, IDE extension, and ChatGPT desktop app.",
  },
  {
    id: "cursor",
    label: "Cursor",
    icon: MousePointer2,
    // The snippet is the manual fallback; the install link is the real path.
    command: `"dopl": { "url": "${MCP_URL}" }`,
    hint: "Or paste the snippet into ~/.cursor/mcp.json.",
    install: { label: "Add to Cursor", href: CURSOR_INSTALL_URL },
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

export function ConnectSection() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tab-independent for the same reason as the Ontology banner: the pad's
  // natural size doesn't change with the selected tab (the terminal body is a
  // fixed-height row), so the hook never needs to know `active`.
  const { mode: glassMode, bannerRef, glassRef } = useGlassScrub();
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
    <ScrollReveal className="lp-connect">
      <div className="lp-connect-inner">
        <p className="lp-connect-eyebrow">Connect</p>
        <h2 className="lp-connect-heading">Connect your agent via MCP, SDK, or CLI</h2>

        <div className="lp-connect-band" data-glass={glassMode} ref={bannerRef}>
          {/* One glass panel for tabs + terminal, seated in a scrubbed BOX —
              square until the band nears viewport centre, then it grows and
              the pad's content fades in (./use-glass-scrub, same behavior
              as the Ontology banner). `staticMap` while scrubbing, for the
              reason hero-banner records: an animating box must not rebuild the
              displacement map per frame. */}
          <div className="lp-connect-glass-box" ref={glassRef}>
            <LiquidGlass
              radius={18}
              staticMap={glassMode === "scrub"}
              className="lp-connect-glass"
            >
              <div className="lp-connect-glass-pad">
          <div
            className="lp-connect-tabs"
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
                  id={`lp-connect-tab-${item.id}`}
                  ref={(node) => {
                    tabRefs.current[i] = node;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="lp-connect-panel"
                  tabIndex={selected ? 0 : -1}
                  className="lp-connect-tab"
                  data-active={selected}
                  onClick={() => select(i)}
                >
                  <Icon className="lp-connect-tab-icon" size={15} strokeWidth={1.9} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="lp-connect-term">
            <div className="lp-connect-term-bar">
              <span className="lp-connect-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <button
                type="button"
                className="lp-connect-copy"
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
              id="lp-connect-panel"
              role="tabpanel"
              aria-labelledby={`lp-connect-tab-${tab.id}`}
              className="lp-connect-term-body"
            >
              <span className="lp-connect-prompt" aria-hidden>
                &rsaquo;
              </span>
              <code className="lp-connect-cmd">{tab.command}</code>
            </div>
          </div>

          {/* ⚠ Rendered for EVERY tab at a FIXED height (see `.lp-connect-hint`),
              empty or not — the glass-scrub hook measures the pad once and a
              tab-dependent height would break that measurement (same rationale
              as the fixed `.lp-connect-term-body`). */}
          <div key={`${tab.id}-hint`} className="lp-connect-hint">
            {tab.install && (
              <a
                href={tab.install.href}
                className="lp-btn lp-btn--sm lp-btn--3d"
              >
                {tab.install.label}
                <ArrowRight size={14} strokeWidth={2} aria-hidden />
              </a>
            )}
            {tab.hint && <span>{tab.hint}</span>}
          </div>
              </div>
            </LiquidGlass>
          </div>
        </div>

        <div className="lp-connect-cta">
          <a href="/playground" className="lp-btn lp-btn--sm lp-btn--3d">
            Try in playground
            <ArrowRight size={14} strokeWidth={2} aria-hidden />
          </a>
        </div>
      </div>
    </ScrollReveal>
  );
}
