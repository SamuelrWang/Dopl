"use client";

/**
 * ConnectClients — per-client MCP setup cards for the overview page.
 *
 * One card per agent (Claude Code, Codex CLI, Claude Desktop / claude.ai)
 * with the exact command or URL to copy, the 2-3 steps that follow, and a
 * link to the client's official setup docs. Auth is OAuth — the browser
 * opens once to sign in; no API keys.
 *
 * Light-token styling to match the members/KB pages (card-surface +
 * border-border-default).
 */

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";

const DOCS = {
  claudeCode: "https://code.claude.com/docs/en/mcp",
  codex: "https://developers.openai.com/codex/mcp",
  connectors:
    "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
} as const;

export function ConnectClients() {
  const [origin, setOrigin] = useState("https://www.usedopl.com");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  const url = `${origin}/api/mcp`;

  return (
    <div className="grid gap-3">
      <ClientCard
        name="Claude Code"
        docsHref={DOCS.claudeCode}
        snippets={[
          {
            id: "cc-add",
            label: "Add the server",
            text: `claude mcp add --transport http dopl ${url}`,
          },
        ]}
        steps={[
          "Run the command in any terminal (add --scope user to enable it across all projects).",
          "Inside Claude Code, run /mcp and pick dopl — your browser opens once to sign in.",
        ]}
      />
      <ClientCard
        name="Codex CLI"
        docsHref={DOCS.codex}
        snippets={[
          { id: "cx-add", label: "Add the server", text: `codex mcp add dopl --url ${url}` },
          { id: "cx-login", label: "Sign in", text: "codex mcp login dopl" },
        ]}
        steps={[
          "Both commands run in any terminal; login opens the browser for OAuth.",
          "Prefer config files? Add [mcp_servers.dopl] with url = \"" + url + "\" to ~/.codex/config.toml.",
        ]}
      />
      <ClientCard
        name="Claude Desktop & claude.ai"
        docsHref={DOCS.connectors}
        snippets={[{ id: "web-url", label: "Server URL", text: url }]}
        steps={[
          "Settings → Connectors → Add custom connector, then paste the URL.",
          "Click Connect to run the sign-in flow.",
        ]}
      />
    </div>
  );
}

function ClientCard({
  name,
  docsHref,
  snippets,
  steps,
}: {
  name: string;
  docsHref: string;
  snippets: Array<{ id: string; label: string; text: string }>;
  steps: string[];
}) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(text: string, id: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="rounded-xl border border-border-default bg-[var(--card-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-text-primary">{name}</h3>
        <a
          href={docsHref}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-0.5 text-[11px] text-text-tertiary hover:text-text-primary transition-colors"
        >
          Setup docs
          <ArrowUpRight size={11} />
        </a>
      </div>

      <div className="mt-3 space-y-2">
        {snippets.map((s) => (
          <div key={s.id} className="space-y-1">
            <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
              {s.label}
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border-default bg-surface-raised-1 px-3 py-2">
              <code className="flex-1 truncate font-mono text-[12px] text-text-secondary">
                {s.text}
              </code>
              <button
                type="button"
                onClick={() => copy(s.text, s.id)}
                className="shrink-0 text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
                title="Copy"
                aria-label={`Copy ${s.label}`}
              >
                {copied === s.id ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      <ol className="mt-3 space-y-1">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-text-tertiary">
            <span className="shrink-0 font-mono text-[10px] text-text-secondary/50 pt-0.5">
              {i + 1}.
            </span>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}
