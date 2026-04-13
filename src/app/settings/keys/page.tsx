"use client";

import { useEffect, useState } from "react";

interface ApiKey {
  id: string;
  key_prefix: string;
  name: string;
  rate_limit_rpm: number;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

type ConnectTab = "cli" | "desktop";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKeyPlaintext, setNewKeyPlaintext] = useState<string | null>(null);
  const [tab, setTab] = useState<ConnectTab>("cli");
  const [copied, setCopied] = useState(false);

  async function fetchKeys() {
    const res = await fetch("/api/user/keys");
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchKeys();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);

    const res = await fetch("/api/user/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName.trim() }),
    });

    if (res.ok) {
      const data = await res.json();
      setNewKeyPlaintext(data.key);
      setNewKeyName("");
      fetchKeys();
    }
    setCreating(false);
  }

  async function handleRevoke(id: string) {
    const res = await fetch(`/api/user/keys/${id}`, { method: "DELETE" });
    if (res.ok) {
      fetchKeys();
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://your-app-url.com";
  const effectiveKey = newKeyPlaintext || (activeKeys[0] ? `${activeKeys[0].key_prefix}...` : "YOUR_API_KEY");
  const hasKey = activeKeys.length > 0 || !!newKeyPlaintext;

  const cliCommand = `claude mcp add setup-intelligence --scope user --transport stdio -e SIE_BASE_URL=${baseUrl} -- npx @sie/mcp-server --api-key ${effectiveKey}`;

  const desktopConfig = JSON.stringify(
    {
      mcpServers: {
        "setup-intelligence": {
          command: "npx",
          args: ["@sie/mcp-server", "--api-key", effectiveKey],
          env: { SIE_BASE_URL: baseUrl },
        },
      },
    },
    null,
    2
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-xl font-medium text-text-primary mb-2">
        Connect to Claude
      </h1>
      <p className="text-sm text-text-tertiary mb-6">
        Connect your Claude to Setup Intelligence in one step.
      </p>

      {/* Step 1: Generate key */}
      {!hasKey && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-primary text-black text-xs font-bold">1</span>
            <p className="text-sm text-text-secondary font-medium">Generate your connection key</p>
          </div>
          <form onSubmit={handleCreate} className="flex gap-2">
            <input
              type="text"
              placeholder="Key name (e.g. My Laptop)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg text-sm
                bg-black/[0.3] border border-white/[0.08] text-text-primary
                placeholder:text-text-tertiary
                focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20
                transition-all"
            />
            <button
              type="submit"
              disabled={creating || !newKeyName.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium
                bg-accent-primary text-black
                hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed
                transition-all cursor-pointer"
            >
              {creating ? "..." : "Generate"}
            </button>
          </form>
        </div>
      )}

      {/* New key flash */}
      {newKeyPlaintext && (
        <div className="mb-6 rounded-xl bg-accent-primary/[0.08] border border-accent-primary/[0.2] p-4">
          <p className="text-sm text-accent-primary font-medium mb-2">
            Save this key — it won&apos;t be shown again
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-black/[0.3] rounded-lg px-3 py-2 text-text-primary font-mono break-all select-all">
              {newKeyPlaintext}
            </code>
            <button
              onClick={() => copy(newKeyPlaintext)}
              className="shrink-0 px-3 py-2 text-xs rounded-lg bg-white/[0.06] border border-white/[0.1]
                text-text-secondary hover:text-text-primary hover:bg-white/[0.1] transition-all cursor-pointer"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Connect instructions — shown when user has a key */}
      {hasKey && (
        <div className="mb-8 rounded-xl bg-white/[0.03] border border-white/[0.08] overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-white/[0.08]">
            <button
              onClick={() => setTab("cli")}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                tab === "cli"
                  ? "text-accent-primary border-b-2 border-accent-primary bg-accent-primary/[0.04]"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              Claude Code (CLI)
            </button>
            <button
              onClick={() => setTab("desktop")}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                tab === "desktop"
                  ? "text-accent-primary border-b-2 border-accent-primary bg-accent-primary/[0.04]"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              Claude Desktop App
            </button>
          </div>

          <div className="p-4">
            {tab === "cli" ? (
              <>
                <p className="text-xs text-text-tertiary mb-3">
                  Paste this in your terminal. One command, done.
                </p>
                <div className="flex items-start gap-2">
                  <code className="flex-1 text-xs bg-black/[0.4] rounded-lg px-3 py-2.5 text-text-primary font-mono break-all leading-relaxed select-all">
                    {cliCommand}
                  </code>
                  <button
                    onClick={() => copy(cliCommand)}
                    className="shrink-0 px-4 py-2.5 text-xs rounded-lg font-medium
                      bg-accent-primary text-black
                      hover:brightness-110 transition-all cursor-pointer"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-text-tertiary mt-3">
                  Restart Claude Code after running. Requires{" "}
                  <code className="text-text-secondary">npm i -g @anthropic-ai/claude-code</code>.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-text-tertiary mb-3">
                  Add this to your Claude Desktop config file, then restart the app.
                </p>
                <div className="flex items-start gap-2">
                  <pre className="flex-1 text-xs bg-black/[0.4] rounded-lg px-3 py-2.5 text-text-primary font-mono overflow-x-auto leading-relaxed select-all">
                    {desktopConfig}
                  </pre>
                  <button
                    onClick={() => copy(desktopConfig)}
                    className="shrink-0 px-4 py-2.5 text-xs rounded-lg font-medium
                      bg-accent-primary text-black
                      hover:brightness-110 transition-all cursor-pointer"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div className="mt-3 text-xs text-text-tertiary space-y-1">
                  <p className="font-medium text-text-secondary">Config file location:</p>
                  <p>macOS: <code className="text-text-secondary">~/Library/Application Support/Claude/claude_desktop_config.json</code></p>
                  <p>Windows: <code className="text-text-secondary">%APPDATA%\Claude\claude_desktop_config.json</code></p>
                </div>
              </>
            )}

            {!newKeyPlaintext && activeKeys.length > 0 && (
              <p className="text-xs text-amber-400/80 mt-3">
                Replace <code className="font-mono">{activeKeys[0].key_prefix}...</code> with your full API key.
                Generate a new key below if needed.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Generate another key (when keys already exist) */}
      {!newKeyPlaintext && activeKeys.length > 0 && (
        <div className="mb-6">
          <form onSubmit={handleCreate} className="flex gap-2">
            <input
              type="text"
              placeholder="Key name (e.g. Work Laptop)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg text-sm
                bg-black/[0.3] border border-white/[0.08] text-text-primary
                placeholder:text-text-tertiary
                focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20
                transition-all"
            />
            <button
              type="submit"
              disabled={creating || !newKeyName.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium
                bg-accent-primary text-black
                hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed
                transition-all cursor-pointer"
            >
              {creating ? "..." : "Generate New Key"}
            </button>
          </form>
        </div>
      )}

      {/* Existing keys */}
      {activeKeys.length > 0 && (
        <details>
          <summary className="text-xs text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors mb-2">
            Manage existing keys ({activeKeys.length})
          </summary>
          <div className="space-y-2">
            {activeKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.08] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-text-primary font-medium">
                    {key.name}
                  </p>
                  <p className="text-xs text-text-tertiary font-mono">
                    {key.key_prefix}...
                  </p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    Created {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used_at && (
                      <>
                        {" "}
                        &middot; Last used{" "}
                        {new Date(key.last_used_at).toLocaleDateString()}
                      </>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => handleRevoke(key.id)}
                  className="shrink-0 px-3 py-1.5 text-xs rounded-lg
                    text-red-400 border border-red-400/[0.2] hover:bg-red-400/[0.08]
                    transition-all cursor-pointer"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
