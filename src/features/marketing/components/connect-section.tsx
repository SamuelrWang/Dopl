"use client";

import { useRef, useState } from "react";
import { ArrowRight, Check, Copy } from "lucide-react";
import { GET_STARTED_LABEL, GET_STARTED_URL } from "../constants";
import { ScrollReveal } from "./scroll-reveal";

/**
 * Laid out like Monitoring (Samuel 2026-10-21: no sky band, no glass): it
 * wears control-section.tsx's `.lp-ctl-*` layout classes. Left: eyebrow,
 * heading, one line, the logo tiles, CTAs. Right: Control's grey panel with
 * the `dopl-mcp` code window (`.lp-connect-term`, the window sdk-section.tsx
 * also wears) floating in it.
 */

/**
 * ⚠ NOT a subdomain — MCP route lives on the app origin; do not "tidy" into
 * mcp.usedopl.com. Same value the desktop derives at runtime
 * (`dopl-desktop-app/main/config.js` › `MCP_URL`), served by
 * `src/app/api/mcp/route.ts`.
 */
const MCP_URL = "https://www.usedopl.com/api/mcp";

/** Codex CLI: `--url` is the flag for a Streamable-HTTP (remote) server. One
 *  command covers Codex in the ChatGPT desktop app, CLI and IDE extension
 *  (same ~/.codex/config.toml; verified 2026-08-17). */
const CODEX_COMMAND = `codex mcp add dopl --url ${MCP_URL}`;

/**
 * Cursor's official one-click install link: base64 of the mcp.json server
 * body (cursor.com/docs/context/mcp/install-links, verified 2026-08-17).
 * Config is `{"url": MCP_URL}` — regenerate if MCP_URL ever changes:
 * `node -e 'console.log(Buffer.from(JSON.stringify({url:"<MCP_URL>"})).toString("base64"))'`
 */
const CURSOR_INSTALL_URL = `https://cursor.com/en/install-mcp?name=dopl&config=${encodeURIComponent(
  "eyJ1cmwiOiJodHRwczovL3d3dy51c2Vkb3BsLmNvbS9hcGkvbWNwIn0=",
)}`;

/** `appIcon`: a full-bleed app icon, rounded like the OS does. */
type Logo = { src: string; alt: string; appIcon?: boolean };

/**
 * One white 3D tile per client, logo only (Samuel: no names; the name rides on
 * aria-label/title). Files: public/img/logos/ (lobehub icons-static-svg@1.95.1,
 * the desktop gemini asset, and grok-bot.png = the App Store icon of "Grok Bot"
 * by X Corp., apps.apple.com/app/id6794501026 — NOT the Grok logo) and
 * public/img/onboarding/.
 * ⚠ Grok Bot: no official SpaceXAI doc for its MCP setup was found
 * (2026-10-16), so the window claims no Grok Bot steps.
 */
const LOGOS: readonly Logo[] = [
  { src: "/img/onboarding/claude-logo.svg", alt: "Claude" },
  { src: "/img/onboarding/chatgpt-logo.svg", alt: "ChatGPT" },
  { src: "/img/logos/grok-bot.png", alt: "Grok Bot", appIcon: true },
  { src: "/img/logos/gemini.svg", alt: "Gemini" },
  { src: "/img/onboarding/muse-logo.svg", alt: "Muse" },
  { src: "/img/onboarding/grok-logo.svg", alt: "Grok" },
  { src: "/img/logos/ollama.svg", alt: "Ollama" },
  { src: "/img/logos/cursor.svg", alt: "Cursor" },
  { src: "/img/logos/openclaw.svg", alt: "OpenClaw" },
];

type Tok = { k?: "str"; t: string };

/** Code-window rows: a `#` comment naming the client, then the value to copy. */
const ROWS: readonly {
  id: string;
  label: string;
  comment: string;
  value: readonly Tok[];
  copy: string;
}[] = [
  {
    id: "claude",
    label: "Claude connector URL",
    comment: "Claude: Settings › Connectors › Add custom connector",
    value: [{ k: "str", t: MCP_URL }],
    copy: MCP_URL,
  },
  {
    id: "codex",
    label: "Codex command",
    comment: "ChatGPT (Codex app, CLI, IDE)",
    value: [{ t: "codex mcp add dopl --url " }, { k: "str", t: MCP_URL }],
    copy: CODEX_COMMAND,
  },
  {
    id: "any",
    label: "MCP URL",
    comment: "Any MCP client",
    value: [{ k: "str", t: MCP_URL }],
    copy: MCP_URL,
  },
];

export function ConnectSection() {
  const [copied, setCopied] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function onCopy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Blocked (insecure origin, denied permission) — never claim a copy
      // that didn't happen.
      return;
    }
    setCopied(id);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(null), 900);
  }

  return (
    <ScrollReveal className="lp-ctl lp-connect">
      <div className="lp-ctl-inner">
        <div className="lp-ctl-copy">
          <p className="lp-ctl-eyebrow">Integrations</p>
          <h2 className="lp-ctl-heading">Works with the tools you already use</h2>
          <p className="lp-connect-lede">Add Dopl to any agent that speaks MCP.</p>

          <ul className="lp-connect-grid" aria-label="Supported agents">
            {LOGOS.map((logo) => (
              <li key={logo.alt}>
                {/* Landing's white 3D button face (`.lp-icon-btn`). */}
                <span
                  role="img"
                  aria-label={logo.alt}
                  title={logo.alt}
                  className="lp-icon-btn lp-connect-grid-btn"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- tiny static asset */}
                  <img
                    src={logo.src}
                    alt=""
                    className="lp-connect-grid-logo"
                    data-app-icon={logo.appIcon || undefined}
                  />
                </span>
              </li>
            ))}
          </ul>

          <div className="lp-ctl-cta">
            <a href={GET_STARTED_URL} className="lp-btn lp-btn--sm lp-btn--3d">
              {GET_STARTED_LABEL}
              <ArrowRight size={14} strokeWidth={2} aria-hidden />
            </a>
            <a href="/playground" className="lp-ctl-secondary">
              Try in playground
            </a>
          </div>
        </div>

        <div className="lp-ctl-panel">
          <div className="lp-connect-term">
            <div className="lp-connect-term-bar">
              <span className="lp-connect-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="lp-connect-file">dopl-mcp</span>
            </div>
            <div className="lp-connect-code">
              {ROWS.map((row) => {
                const done = copied === row.id;
                return (
                  <div key={row.id} className="lp-connect-block">
                    <code className="lp-connect-comment"># {row.comment}</code>
                    <div className="lp-connect-row">
                      <code className="lp-connect-cmd">
                        {row.value.map((tok, i) => (
                          <span key={i} className={tok.k ? `lp-connect-${tok.k}` : undefined}>
                            {tok.t}
                          </span>
                        ))}
                      </code>
                      <button
                        type="button"
                        className="lp-connect-copy"
                        data-copied={done}
                        aria-label={done ? `${row.label} copied` : `Copy ${row.label}`}
                        onClick={() => onCopy(row.id, row.copy)}
                      >
                        {done && <span aria-live="polite">Copied</span>}
                        {done ? (
                          <Check size={14} strokeWidth={2} aria-hidden />
                        ) : (
                          <Copy size={14} strokeWidth={1.8} aria-hidden />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
              <code className="lp-connect-comment">
                # Cursor:{" "}
                <a href={CURSOR_INSTALL_URL} className="lp-connect-install">
                  one-click install
                </a>
              </code>
            </div>
          </div>
        </div>
      </div>
    </ScrollReveal>
  );
}
