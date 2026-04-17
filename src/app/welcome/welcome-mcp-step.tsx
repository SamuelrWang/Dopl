"use client";

/**
 * WelcomeMcpConnectStep — the tabbed MCP connection card shown during the
 * /welcome flow. Three tabs (Claude Code, Codex, Openclaw), each showing:
 *   1. A CLI command the user can run directly.
 *   2. An "agent prompt" — a single paste-able string that tells the user's
 *      AI agent how to wire up the Dopl MCP server itself.
 *
 * Polls /api/user/mcp-status every 3s; calls onConnected() once the MCP
 * server pings in. Reuses /api/user/keys to mint a fresh API key.
 *
 * NOTE: The older `McpConnectStep` (in src/components/onboarding/) is still
 * used by the in-canvas OnboardingCoachCard. This welcome-specific variant
 * is wider, tabbed, and shows the agent-prompt affordance. Keeping them as
 * two files avoids polluting the simpler in-canvas card.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useMcpConnectionStatus } from "@/lib/hooks/use-mcp-connection-status";

// ─────────────────────────────────────────────────────────
// Tab definitions
// ─────────────────────────────────────────────────────────

type TabKey = "claude-code" | "codex" | "openclaw";

interface TabDef {
  key: TabKey;
  label: string;
  /** Paragraph shown above the CLI command. */
  commandHeading: string;
  /** The CLI command to run in the user's terminal. */
  buildCommand: (args: { apiKey: string; baseUrl: string }) => string;
}

// Codex and Openclaw configs are educated guesses — swap for the real
// invocations once confirmed. The agent-prompt below is shared across
// tabs because the agent figures out the correct invocation for its env.
const TABS: TabDef[] = [
  {
    key: "claude-code",
    label: "Claude Code",
    commandHeading: "Run this in your terminal:",
    buildCommand: ({ apiKey, baseUrl }) =>
      `claude mcp add dopl --scope user --transport stdio -e DOPL_BASE_URL=${baseUrl} -- npx @dopl/mcp-server --api-key ${apiKey}`,
  },
  {
    key: "codex",
    label: "Codex",
    commandHeading: "Run this in your terminal:",
    buildCommand: ({ apiKey, baseUrl }) =>
      `codex mcp add dopl --env DOPL_BASE_URL=${baseUrl} -- npx @dopl/mcp-server --api-key ${apiKey}`,
  },
  {
    key: "openclaw",
    label: "Openclaw",
    commandHeading: "Run this in your terminal:",
    buildCommand: ({ apiKey, baseUrl }) =>
      `openclaw mcp add dopl --env DOPL_BASE_URL=${baseUrl} -- npx @dopl/mcp-server --api-key ${apiKey}`,
  },
];

// ─────────────────────────────────────────────────────────
// Agent prompt builder — shared across tabs
// ─────────────────────────────────────────────────────────

function buildAgentPrompt(apiKey: string, baseUrl: string): string {
  const config = JSON.stringify(
    {
      dopl: {
        command: "npx",
        args: ["@dopl/mcp-server", "--api-key", apiKey],
        env: { DOPL_BASE_URL: baseUrl },
      },
    },
    null,
    2
  );
  return `Connect yourself to the Dopl MCP server using this JSON configuration:\n${config}`;
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

interface WelcomeMcpConnectStepProps {
  /** Called when the MCP server first pings in for this user. */
  onConnected: () => void;
}

export function WelcomeMcpConnectStep({
  onConnected,
}: WelcomeMcpConnectStepProps) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("claude-code");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Resolve deploy URL for snippets.
  useEffect(() => {
    if (typeof window !== "undefined") setBaseUrl(window.location.origin);
  }, []);

  // Mint a fresh API key for the flow.
  useEffect(() => {
    let cancelled = false;
    async function fetchKey() {
      try {
        const genRes = await fetch("/api/user/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Onboarding MCP" }),
        });
        if (!cancelled && genRes.ok) {
          const genData = await genRes.json();
          if (genData.key) setApiKey(genData.key);
        }
      } catch {
        // Fail silently — the UI will show the "Could not generate API key" state.
      }
      if (!cancelled) setLoading(false);
    }
    fetchKey();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll for connection. The hook sets `connected` immediately so the
  // success state flashes, then we wait 1200ms before telling the parent
  // to advance (so the user actually sees "Connected!").
  const { connected } = useMcpConnectionStatus({
    enabled: !loading,
    onConnected: useCallback(() => {
      setTimeout(() => onConnected(), 1200);
    }, [onConnected]),
  });

  const handleCopy = useCallback((id: string, text: string) => {
    if (typeof navigator === "undefined") return;
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === id ? null : prev));
    }, 2000);
  }, []);

  // Build snippets for the active tab — re-derived each render so the keys
  // update instantly when the key finishes loading.
  const { command, agentPrompt } = useMemo(() => {
    const url = baseUrl || "https://your-deployment.example";
    const key = apiKey ?? "<your-key>";
    const tab = TABS.find((t) => t.key === activeTab) ?? TABS[0];
    return {
      command: tab.buildCommand({ apiKey: key, baseUrl: url }),
      agentPrompt: buildAgentPrompt(key, url),
    };
  }, [activeTab, apiKey, baseUrl]);

  // ── Empty / loading / success states ─────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3">
        <div className="w-2 h-2 rounded-full bg-white/30 animate-pulse" />
        <span className="text-[11px] font-mono text-white/40">
          Preparing connection details...
        </span>
      </div>
    );
  }

  if (connected) {
    return (
      <div
        className="py-4 text-center"
        style={{ animation: "coachFlash 0.4s ease-out both" }}
      >
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <span className="text-sm font-mono text-emerald-400 uppercase tracking-wider font-medium">
            Connected!
          </span>
        </div>
        <p className="text-[11px] font-mono text-white/40">
          Your agent is now wired up to Dopl.
        </p>
      </div>
    );
  }

  if (!apiKey) {
    return (
      <p className="text-[11px] font-mono text-white/40 py-2">
        Could not generate API key. Please refresh and try again.
      </p>
    );
  }

  // ── Normal state: tabs + command + agent prompt ──────────────────
  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/[0.08]">
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`relative px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors cursor-pointer
                ${isActive ? "text-white" : "text-white/40 hover:text-white/70"}`}
            >
              {tab.label}
              {isActive && (
                <span className="absolute left-0 right-0 -bottom-px h-[1.5px] bg-white/80" />
              )}
            </button>
          );
        })}
      </div>

      {/* Command block */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.15em] text-white/35 font-mono mb-1.5">
          {(TABS.find((t) => t.key === activeTab) ?? TABS[0]).commandHeading}
        </p>
        <div className="relative">
          <button
            onClick={() => handleCopy("command", command)}
            className="absolute top-1.5 right-1.5 z-10 text-white/30 hover:text-white/70 transition-colors"
            title="Copy command"
          >
            {copiedKey === "command" ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          <pre className="text-[9px] font-mono bg-black/[0.4] border border-white/[0.08] rounded-lg p-2.5 pr-7 overflow-x-auto text-white/70 leading-relaxed whitespace-pre-wrap break-all">
            {command}
          </pre>
        </div>
      </div>

      {/* Agent-prompt block */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.15em] text-white/35 font-mono mb-1.5">
          Or give your agent this prompt:
        </p>
        <div className="relative">
          <button
            onClick={() => handleCopy("agent", agentPrompt)}
            className="absolute top-1.5 right-1.5 z-10 text-white/30 hover:text-white/70 transition-colors"
            title="Copy agent prompt"
          >
            {copiedKey === "agent" ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          <pre className="text-[9px] font-mono bg-black/[0.4] border border-white/[0.08] rounded-lg p-2.5 pr-7 overflow-x-auto text-white/60 leading-relaxed whitespace-pre-wrap break-all">
            {agentPrompt}
          </pre>
        </div>
      </div>

      {/* Waiting pulse */}
      <div className="flex items-center gap-2 pt-1">
        <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse" />
        <span className="text-[10px] uppercase tracking-[0.15em] text-white/30 font-mono">
          Waiting for connection...
        </span>
      </div>
    </div>
  );
}
