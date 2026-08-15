"use client";

/**
 * Per-client MCP setup cards: one per agent (Claude Code, Codex CLI, Claude
 * Desktop / claude.ai) with the command or URL to copy, the following steps,
 * and a link to that client's setup docs. Auth is OAuth — browser sign-in once,
 * no API keys.
 */

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { CopyButton } from "@/shared/ui/copy-button";
import { getAppOrigin } from "@/shared/lib/app-origin";

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
    setOrigin(getAppOrigin());
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
  return (
    <section className="rounded-xl border border-border-default bg-bg-elevated p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-title font-medium text-text-primary">{name}</h3>
        <a
          href={docsHref}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-0.5 text-caption text-text-tertiary hover:text-text-primary transition-colors"
        >
          Setup docs
          <ArrowUpRight size={11} />
        </a>
      </div>

      <div className="mt-3 space-y-2">
        {snippets.map((s) => (
          <div key={s.id} className="space-y-1">
            <p className="text-micro font-mono uppercase tracking-wider text-text-secondary/60">
              {s.label}
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border-default bg-surface-raised-1 px-3 py-2">
              <code className="flex-1 truncate font-mono text-small text-text-secondary">
                {s.text}
              </code>
              <CopyButton text={s.text} label={`Copy ${s.label}`} />
            </div>
          </div>
        ))}
      </div>

      <ol className="mt-3 space-y-1">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2 text-small leading-relaxed text-text-tertiary">
            <span className="shrink-0 font-mono text-micro text-text-secondary/50 pt-0.5">
              {i + 1}.
            </span>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}
