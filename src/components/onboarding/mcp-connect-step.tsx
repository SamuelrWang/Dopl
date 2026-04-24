"use client";

/**
 * McpConnectStep — embedded in the onboarding coaching card for the MCP
 * connection step. Shows the user's MCP config with a Copy button, then
 * polls /api/user/mcp-status every 3s to detect when the connection goes live.
 *
 * States:
 *   1. Loading API key (brief spinner)
 *   2. Config visible + "Waiting for connection..." pulse
 *   3. "Connected!" success → calls onConnected() to auto-advance
 */

import { useEffect, useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { useMcpConnectionStatus } from "@/shared/hooks/use-mcp-connection-status";

interface McpConnectStepProps {
  /** Called when MCP connection is detected — triggers auto-advance. */
  onConnected: () => void;
}

export function McpConnectStep({ onConnected }: McpConnectStepProps) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Get base URL
  useEffect(() => {
    if (typeof window !== "undefined") setBaseUrl(window.location.origin);
  }, []);

  // Fetch the user's API key (reuse from connection panel logic)
  useEffect(() => {
    async function fetchKey() {
      try {
        const res = await fetch("/api/user/keys");
        if (!res.ok) { setLoading(false); return; }
        const data = await res.json();
        const active = (data.keys || []).filter(
          (k: { revoked_at: string | null; key_prefix?: string }) => !k.revoked_at
        );
        if (active.length > 0 && active[0].key_prefix) {
          // We only have the prefix from existing keys — need to generate a new one
          // to show the full key. But if the connection panel already generated one,
          // we won't have the full key. Generate a fresh one for onboarding.
          const genRes = await fetch("/api/user/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Onboarding MCP" }),
          });
          if (genRes.ok) {
            const genData = await genRes.json();
            setApiKey(genData.key);
          }
        } else {
          // No keys — generate one
          const genRes = await fetch("/api/user/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Onboarding MCP" }),
          });
          if (genRes.ok) {
            const genData = await genRes.json();
            setApiKey(genData.key);
          }
        }
      } catch {
        // Silently fail
      }
      setLoading(false);
    }
    fetchKey();
  }, []);

  // Poll for MCP connection status. Hook handles the single-fire guarantee
  // and interval teardown; we add the 1.5s delay so the success state is
  // actually visible before the parent auto-advances.
  const { connected } = useMcpConnectionStatus({
    enabled: !loading,
    onConnected: useCallback(() => {
      setTimeout(() => onConnected(), 1500);
    }, [onConnected]),
  });

  const handleCopy = useCallback(
    (text: string) => {
      if (typeof navigator === "undefined") return;
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    []
  );

  const url = baseUrl || "https://your-deployment.example";

  // Claude Code CLI command (easiest for most users)
  const cliCommand = apiKey
    ? `claude mcp add dopl --scope user --transport stdio -e DOPL_BASE_URL=${url} -- npx @dopl/mcp-server --api-key ${apiKey}`
    : null;

  // JSON config for manual setup
  const jsonConfig = apiKey
    ? JSON.stringify(
        {
          "dopl": {
            command: "npx",
            args: ["@dopl/mcp-server", "--api-key", apiKey],
            env: { DOPL_BASE_URL: url },
          },
        },
        null,
        2
      )
    : null;

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
          Your AI assistant is now linked to your workspace.
        </p>
      </div>
    );
  }

  if (!apiKey) {
    return (
      <p className="text-[11px] font-mono text-white/40 py-2">
        Could not generate API key. Check the connection panel.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* CLI command (recommended) */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.15em] text-white/35 font-mono mb-1.5">
          Claude Code — run this command:
        </p>
        <div className="relative">
          <button
            onClick={() => handleCopy(cliCommand!)}
            className="absolute top-1.5 right-1.5 z-10 text-white/30 hover:text-white/70 transition-colors"
            title="Copy command"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          <pre className="text-[9px] font-mono bg-black/[0.4] border border-white/[0.08] rounded-lg p-2.5 pr-7 overflow-x-auto text-white/70 leading-relaxed whitespace-pre-wrap break-all">
            {cliCommand}
          </pre>
        </div>
      </div>

      {/* JSON config (alternative) */}
      <details className="group">
        <summary className="text-[10px] uppercase tracking-[0.15em] text-white/25 font-mono cursor-pointer hover:text-white/40 transition-colors">
          Or add JSON config manually
        </summary>
        <div className="relative mt-1.5">
          <button
            onClick={() => handleCopy(jsonConfig!)}
            className="absolute top-1.5 right-1.5 z-10 text-white/30 hover:text-white/70 transition-colors"
            title="Copy config"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          <pre className="text-[9px] font-mono bg-black/[0.4] border border-white/[0.08] rounded-lg p-2.5 pr-7 overflow-x-auto text-white/60 leading-relaxed">
            {jsonConfig}
          </pre>
        </div>
      </details>

      {/* Waiting indicator */}
      <div className="flex items-center gap-2 pt-1">
        <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse" />
        <span className="text-[10px] uppercase tracking-[0.15em] text-white/30 font-mono">
          Waiting for connection...
        </span>
      </div>
    </div>
  );
}
