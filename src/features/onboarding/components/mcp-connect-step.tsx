"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { DEFAULT_MCP_URL, MCP_SERVER_NAME } from "../constants";
import { buildConnectPrompt } from "../bootstrap-prompt";

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
      <div className="text-center">
        <h1 className="text-[28px] font-semibold leading-tight text-[#1e242b]">
          Connect your AI agent
        </h1>
        <p className="mt-2 text-[15px] text-[#646d78] leading-relaxed">
          Add the <span className="font-semibold text-[#232a31]">MCP</span>{" "}
          server below to your agent, or paste the prompt to let it connect.
          One browser sign-in — no API key.
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
          label="Or paste this prompt to connect"
          text={buildConnectPrompt(url)}
          id="prompt"
          copied={copied}
          onCopy={copy}
          multiline
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        {connected ? (
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-600" />
            <span className="font-mono text-[10px] uppercase tracking-wide text-emerald-700">
              Connected
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 animate-pulse bg-[#6f93bf]" />
            <span className="font-mono text-[10px] uppercase tracking-wide text-[#646d78]">
              Waiting for your agent…
            </span>
          </span>
        )}
        {!connected && (
          <button
            type="button"
            onClick={onSkip}
            disabled={finishing}
            className="text-[14px] font-semibold text-[#646d78]
              hover:text-[#232a31] transition-colors cursor-pointer underline underline-offset-4
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
      <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#98a2ad]">
        {label}
      </p>
      <div className="flex items-start gap-2 rounded-[11px] border-[1.5px] border-[#d6dde5] bg-[#eef1f5] px-3.5 py-2.5">
        <code
          className={`flex-1 font-mono text-[12px] text-[#3a414a] leading-relaxed ${
            multiline ? "whitespace-pre-wrap break-words" : "truncate"
          }`}
        >
          {text}
        </code>
        <button
          type="button"
          onClick={() => onCopy(text, id)}
          className="shrink-0 mt-0.5 text-[#98a2ad] hover:text-[#232a31] transition-colors cursor-pointer"
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
