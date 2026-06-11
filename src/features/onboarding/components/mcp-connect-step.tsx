"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { StatusDot } from "@/shared/design";
import {
  buildAgentConnectPrompt,
  DEFAULT_MCP_URL,
  MCP_SERVER_NAME,
} from "../constants";

interface McpConnectStepProps {
  connected: boolean;
  finishing: boolean;
  onSkip: () => void;
}

/**
 * Onboarding step B — connect an AI agent over MCP. Copy is
 * model-agnostic by design: "your AI agent", never a specific client.
 */
export function McpConnectStep({
  connected,
  finishing,
  onSkip,
}: McpConnectStepProps) {
  const [origin, setOrigin] = useState("https://www.usedopl.com");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  const url = origin ? `${origin}/api/mcp` : DEFAULT_MCP_URL;

  const [copied, setCopied] = useState<string | null>(null);
  function copy(text: string, id: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Connect your AI agent
        </h1>
        <p className="mt-1.5 text-sm text-[var(--text-muted)] leading-relaxed">
          Dopl speaks <span className="text-[var(--text-secondary)]">MCP</span> —
          an open protocol that lets any AI agent read and write your
          workspace: knowledge bases, skills, and canvases. Add the server
          below in your agent&rsquo;s MCP settings, or paste the prompt and let
          it connect itself. A browser window opens once to sign in — no API
          key.
        </p>
      </div>

      <div className="space-y-4">
        <CopyRow
          label="Server name"
          text={MCP_SERVER_NAME}
          id="name"
          copied={copied}
          onCopy={copy}
        />
        <CopyRow
          label="Server URL"
          text={url}
          id="url"
          copied={copied}
          onCopy={copy}
        />
        <CopyRow
          label="Or paste this prompt to your agent"
          text={buildAgentConnectPrompt(url)}
          id="prompt"
          copied={copied}
          onCopy={copy}
          multiline
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        {connected ? (
          <StatusDot state="online" label="Connected" />
        ) : (
          <StatusDot state="connecting" label="Waiting for your agent…" />
        )}
        {!connected && (
          <button
            type="button"
            onClick={onSkip}
            disabled={finishing}
            className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]
              hover:text-[var(--text-secondary)] transition-colors cursor-pointer underline underline-offset-4
              disabled:opacity-50"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

function CopyRow({
  label,
  text,
  id,
  copied,
  onCopy,
  multiline = false,
}: {
  label: string;
  text: string;
  id: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      <div className="flex items-start gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-inset)] px-3 py-2.5">
        <code
          className={`flex-1 font-mono text-[12px] text-[var(--text-secondary)] leading-relaxed ${
            multiline ? "whitespace-pre-wrap break-words" : "truncate"
          }`}
        >
          {text}
        </code>
        <button
          type="button"
          onClick={() => onCopy(text, id)}
          className="shrink-0 mt-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
          title="Copy"
        >
          {copied === id ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
