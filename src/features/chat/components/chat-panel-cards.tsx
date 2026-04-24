"use client";

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * Inline onboarding card: walk the user through installing the Dopl
 * MCP server in Claude Code / Cursor / other agents. Tabs pick the
 * platform; the component lazy-fetches (and if absent, creates) the
 * user's API key so the copy-paste commands work immediately.
 */
export function McpSetupCard() {
  const [tab, setTab] = useState<"claude" | "cursor" | "other">("claude");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/user/keys")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const active = (data.keys || []).filter(
          (k: { revoked_at: string | null }) => !k.revoked_at
        );
        if (active.length > 0) return; // key exists, generate new
        return fetch("/api/user/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Onboarding MCP" }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && setApiKey(d.key));
      })
      .catch(() => {});

    // Also try to generate if no keys found
    fetch("/api/user/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Onboarding MCP" }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setApiKey(d.key))
      .catch(() => {});
  }, []);

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const keyPlaceholder = apiKey || "YOUR_API_KEY";

  const cliCommand =
    tab === "claude"
      ? `claude mcp add dopl --scope user --transport stdio -- npx @dopl/mcp-server --api-key ${keyPlaceholder}`
      : tab === "cursor"
        ? `npx @dopl/mcp-server --api-key ${keyPlaceholder}`
        : `npx @dopl/mcp-server --api-key ${keyPlaceholder}`;

  const jsonConfig =
    tab === "claude"
      ? JSON.stringify({ mcpServers: { dopl: { command: "npx", args: ["@dopl/mcp-server", "--api-key", keyPlaceholder] } } }, null, 2)
      : tab === "cursor"
        ? JSON.stringify({ mcpServers: { dopl: { command: "npx", args: ["@dopl/mcp-server", "--api-key", keyPlaceholder] } } }, null, 2)
        : JSON.stringify({ dopl: { command: "npx", args: ["@dopl/mcp-server", "--api-key", keyPlaceholder] } }, null, 2);

  const tabs: { id: "claude" | "cursor" | "other"; label: string }[] = [
    { id: "claude", label: "Claude Code" },
    { id: "cursor", label: "Cursor" },
    { id: "other", label: "Other" },
  ];

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.04] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-purple-500/10">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400/70">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <span className="font-mono text-[10px] uppercase tracking-wider text-purple-300/70">MCP Connection</span>
      </div>
      <div className="px-3 pt-2 flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-2 py-1 font-mono text-[9px] uppercase tracking-wide rounded-[3px] transition-colors ${
              tab === t.id
                ? "bg-purple-500/15 text-purple-200/90 border border-purple-500/25"
                : "text-white/40 hover:text-white/60 border border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-3 space-y-2">
        {tab === "claude" && (
          <div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-white/30 mb-1">CLI command</div>
            <div className="relative group">
              <pre className="text-[10px] font-mono text-white/60 bg-black/20 rounded p-2 pr-8 overflow-x-auto whitespace-pre-wrap break-all">{cliCommand}</pre>
              <button onClick={() => copy(cliCommand, "cli")} className="absolute top-1.5 right-1.5 text-white/20 hover:text-white/60 transition-colors">
                {copied === "cli" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
        )}
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-white/30 mb-1">
            {tab === "claude" ? "Or add to config JSON" : "MCP Config"}
          </div>
          <div className="relative group">
            <pre className="text-[10px] font-mono text-white/60 bg-black/20 rounded p-2 pr-8 overflow-x-auto whitespace-pre-wrap break-all">{jsonConfig}</pre>
            <button onClick={() => copy(jsonConfig, "json")} className="absolute top-1.5 right-1.5 text-white/20 hover:text-white/60 transition-colors">
              {copied === "json" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>
        {!apiKey && (
          <div className="font-mono text-[9px] text-white/25">Loading your API key...</div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline onboarding card: promote the Dopl Chrome extension for
 * authenticated / paywalled page ingestion.
 */
export function ChromeExtensionCard() {
  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.04] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-blue-500/10">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400/70">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
          <line x1="21.17" y1="8" x2="12" y2="8" />
          <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
          <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
        </svg>
        <span className="font-mono text-[10px] uppercase tracking-wider text-blue-300/70">Chrome Extension</span>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-[11px] text-white/60 leading-relaxed">
          Ingest pages as you browse — right-click to send to your knowledge base. Great for paywalled or login-gated content. Only extracts when you tell it to.
        </p>
        <div className="flex items-center gap-2">
          <a
            href="/downloads/dopl-extension.zip"
            download="dopl-extension.zip"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-blue-200/90 bg-blue-500/15 border border-blue-500/25 rounded-[3px] hover:bg-blue-500/25 transition-colors"
          >
            Download Extension
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7L7 3" /><path d="M4 3H7V6" /></svg>
          </a>
        </div>
        <div className="font-mono text-[9px] text-white/25 leading-relaxed">
          Unzip the download, open chrome://extensions, enable Developer mode, click &quot;Load unpacked&quot;, and select the unzipped folder. Then click the Dopl icon in your toolbar and enter your API key to connect.
        </div>
      </div>
    </div>
  );
}
