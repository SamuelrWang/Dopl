"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { DEFAULT_MCP_URL } from "../constants";
import { buildConnectPrompt } from "../bootstrap-prompt";

interface McpConnectStepProps {
  connected: boolean;
  finishing: boolean;
  /** Onboarding: gated Continue — disabled until connected, then advances. */
  onContinue?: () => void;
  /** Recoverable banner: dismiss/close. */
  onSkip?: () => void;
  showSkip?: boolean;
}

type Client = "claude" | "codex";

/**
 * Onboarding step 2 — connect an AI agent over MCP. Light theme to match the
 * login surface. Leads with the paste-to-connect prompt + a live status;
 * manual setup (server name/URL + per-client steps) is tucked behind a toggle.
 */
export function McpConnectStep({ connected, finishing, onContinue, onSkip, showSkip = true }: McpConnectStepProps) {
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

  const [client, setClient] = useState<Client>("claude");
  const [manualOpen, setManualOpen] = useState(false);

  return (
    <div>
      <h2 className="text-[30px] font-bold leading-tight tracking-[-0.5px] text-[#181818]">
        Connect Your Agent
      </h2>
      <p className="mt-3 text-[15px] leading-relaxed text-[#9a9a9a]">
        Your agent reaches your workspaces through the Dopl MCP server.
      </p>

      {/* Server details + the paste-to-connect prompt */}
      <div className="mt-7 space-y-4">
        <CopyRow label="Server name" text="Dopl" id="name" copied={copied} onCopy={copy} />
        <CopyRow label="Server URL" text={url} id="url" copied={copied} onCopy={copy} />
        <CopyRow
          label="Paste this into your agent"
          text={buildConnectPrompt(url)}
          id="prompt"
          copied={copied}
          onCopy={copy}
          multiline
        />
      </div>

      {/* Live status */}
      <div className="mt-5 flex items-center gap-2">
        {connected ? (
          <>
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-[13px] font-semibold text-emerald-600">Connected</span>
          </>
        ) : (
          <>
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#dc2626]" />
            <span className="text-[13px] font-semibold text-[#dc2626]">Waiting for your agent…</span>
          </>
        )}
      </div>

      {/* Manual setup, tucked away */}
      <button
        type="button"
        onClick={() => setManualOpen((o) => !o)}
        className="mt-6 flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-[#181818] hover:underline"
      >
        <span className={`transition-transform ${manualOpen ? "rotate-90" : ""}`}>›</span>
        Set it up manually instead
      </button>

      {manualOpen && (
        <div className="mt-4 space-y-4" style={{ animation: "loginFadeIn 0.3s ease-out both" }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-[#74808C]">Steps for</p>
            <div className="inline-flex rounded-full border border-[#ddd] bg-[#f3f3f3] p-0.5">
              {(["claude", "codex"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setClient(c)}
                  className={`cursor-pointer rounded-full px-3.5 py-1 text-[12px] font-medium transition-colors ${
                    client === c ? "bg-[#181818] text-white" : "text-[#74808C] hover:text-[#181818]"
                  }`}
                >
                  {c === "claude" ? "Claude" : "Codex"}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[10px] border border-[#e2e2e2] bg-white px-4 py-3.5">
            {client === "claude" ? (
              <ol className="list-decimal space-y-1.5 pl-4 text-[13px] leading-relaxed text-[#555]">
                <li>
                  Open <Strong>Customize</Strong> (left sidebar) → <Strong>Connectors</Strong>.
                </li>
                <li>
                  Click <Strong>+ Add custom connector</Strong>.
                </li>
                <li>Enter the server name and URL above.</li>
              </ol>
            ) : (
              <ol className="list-decimal space-y-1.5 pl-4 text-[13px] leading-relaxed text-[#555]">
                <li>
                  In ChatGPT: <Strong>Settings → Apps &amp; Connectors → Advanced</Strong>, turn on{" "}
                  <Strong>Developer mode</Strong>.
                </li>
                <li>
                  Open <Strong>Settings → Connectors → Create</Strong>.
                </li>
                <li>Enter a name and the server URL above.</li>
              </ol>
            )}
          </div>
        </div>
      )}

      {onContinue ? (
        <div className="mt-9 flex justify-end">
          <button
            type="button"
            onClick={onContinue}
            disabled={!connected || finishing}
            className="cursor-pointer rounded-[12px] bg-[#181818] px-9 py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {finishing ? "Setting up…" : "Continue"}
          </button>
        </div>
      ) : (
        showSkip &&
        !connected && (
          <div className="mt-8 flex justify-end">
            <button
              type="button"
              onClick={onSkip}
              disabled={finishing}
              className="cursor-pointer text-[14px] font-medium text-[#9a9a9a] underline underline-offset-4 transition-colors hover:text-[#181818] disabled:opacity-50"
            >
              Skip for now
            </button>
          </div>
        )
      )}
    </div>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-[#181818]">{children}</span>;
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
      <p className="text-[16px] font-medium text-[#181818]">{label}</p>
      <div className="flex items-start gap-2 rounded-[10px] border border-[#e2e2e2] bg-white px-3.5 py-2.5">
        <span
          className={`flex-1 text-[13px] leading-relaxed text-[#222] ${
            multiline ? "max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words" : "truncate"
          }`}
        >
          {text}
        </span>
        <button
          type="button"
          onClick={() => onCopy(text, id)}
          className="mt-0.5 shrink-0 cursor-pointer text-[#9a9a9a] transition-colors hover:text-[#181818]"
          title="Copy"
        >
          {copied === id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
