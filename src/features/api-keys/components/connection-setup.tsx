"use client";

import { useState } from "react";
import { Copy, Check, Eye, EyeOff } from "lucide-react";
import { MonoLabel } from "@/shared/design";
import { useWorkspaceKey } from "../hooks/use-workspace-key";
import {
  KEY_PLACEHOLDER,
  buildAgentPrompt,
  buildClaudeCli,
  buildClaudeConfig,
  buildCodexConfig,
  buildGenericConfig,
} from "../snippets";

type Platform = "claude" | "codex" | "other";
type CopyFn = (text: string, id: string) => void;

function maskKey(key: string): string {
  if (key.length <= 8) return key;
  return key.slice(0, 8) + "••••••••••••••••";
}

function CopyBtn({
  text,
  id,
  copiedId,
  onCopy,
}: {
  text: string;
  id: string;
  copiedId: string | null;
  onCopy: CopyFn;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(text, id)}
      className="absolute top-2 right-2 z-10 text-text-muted hover:text-text-secondary transition-colors"
      title="Copy"
    >
      {copiedId === id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CodeBlock({
  text,
  id,
  copiedId,
  onCopy,
}: {
  text: string;
  id: string;
  copiedId: string | null;
  onCopy: CopyFn;
}) {
  return (
    <div className="relative">
      <CopyBtn text={text} id={id} copiedId={copiedId} onCopy={onCopy} />
      <pre className="text-[10px] font-mono bg-bg-inset border border-border-default rounded-[3px] p-3 pr-8 overflow-auto text-text-secondary leading-relaxed whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}

/**
 * Unified API-key setup surface — rendered in BOTH the canvas connection
 * panel and the workspace overview/settings. Shows the workspace's single
 * key (masked + eye reveal + copy), revoke→regenerate (one key at a
 * time), and tabbed copy-ready setup snippets auto-filled with the real
 * key.
 */
export function ConnectionSetup({ workspaceSlug }: { workspaceSlug: string }) {
  const { active, plaintext, isLoading, generate, revoke, error } =
    useWorkspaceKey(workspaceSlug);
  const [platform, setPlatform] = useState<Platform>("claude");
  const [revealed, setRevealed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy: CopyFn = (text, id) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center">
        <div className="w-3 h-3 rounded-full bg-accent-primary/40 animate-pulse" />
        <p className="text-xs text-text-muted font-mono">Loading your API key…</p>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="py-6 space-y-3 text-center">
        <p className="text-xs text-text-tertiary leading-relaxed">
          No API key for this workspace yet. Generate one to connect Claude Code,
          Codex, or any MCP tool.
        </p>
        <button
          type="button"
          onClick={() => void generate()}
          className="px-4 py-2 rounded-[3px] font-mono text-[10px] uppercase tracking-wide bg-accent-primary/[0.15] hover:bg-accent-primary/[0.25] border border-accent-primary/[0.3] text-accent-primary transition-colors"
        >
          Generate API key
        </button>
        {error && <p className="text-[10px] text-red-400/90">{error}</p>}
      </div>
    );
  }

  const snippetKey = plaintext ?? KEY_PLACEHOLDER;

  return (
    <div className="space-y-4">
      {/* Platform tabs */}
      <div className="flex gap-1 p-0.5 rounded-[4px] bg-surface-raised-2">
        {(
          [
            { id: "claude" as Platform, label: "Claude Code" },
            { id: "codex" as Platform, label: "Codex" },
            { id: "other" as Platform, label: "Other" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPlatform(tab.id)}
            className={`flex-1 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider rounded-[3px] transition-colors ${
              platform === tab.id
                ? "bg-surface-selected text-text-primary"
                : "text-text-muted hover:text-text-tertiary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {platform === "claude" && (
        <div className="space-y-3">
          <section className="space-y-1.5">
            <MonoLabel tone="muted">Run this command</MonoLabel>
            <CodeBlock text={buildClaudeCli(snippetKey)} id="cli" copiedId={copiedId} onCopy={copy} />
          </section>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-surface-raised-3" />
            <span className="text-[9px] font-mono text-text-disabled uppercase tracking-widest">or add to config</span>
            <div className="flex-1 h-px bg-surface-raised-3" />
          </div>
          <section className="space-y-1.5">
            <MonoLabel tone="muted">Claude Desktop / VS Code config</MonoLabel>
            <CodeBlock text={buildClaudeConfig(snippetKey)} id="claude-config" copiedId={copiedId} onCopy={copy} />
            <p className="text-[10px] text-text-muted leading-relaxed">
              macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
              <br />
              Windows: %APPDATA%\Claude\claude_desktop_config.json
              <br />
              VS Code / Cursor: .mcp.json in project root
            </p>
          </section>
        </div>
      )}

      {platform === "codex" && (
        <section className="space-y-1.5">
          <MonoLabel tone="muted">Add to ~/.codex/config.toml</MonoLabel>
          <CodeBlock text={buildCodexConfig(snippetKey)} id="codex-config" copiedId={copiedId} onCopy={copy} />
        </section>
      )}

      {platform === "other" && (
        <div className="space-y-3">
          <p className="text-xs text-text-secondary leading-relaxed">
            Copy this and give it to any MCP-compatible AI tool. It will set up the connection.
          </p>
          <section className="space-y-1.5">
            <MonoLabel tone="muted">Generic MCP config</MonoLabel>
            <CodeBlock text={buildGenericConfig(snippetKey)} id="generic-config" copiedId={copiedId} onCopy={copy} />
          </section>
          <section className="space-y-1.5">
            <MonoLabel tone="muted">Full instructions</MonoLabel>
            <CodeBlock text={buildAgentPrompt(snippetKey)} id="instructions" copiedId={copiedId} onCopy={copy} />
          </section>
        </div>
      )}

      {/* Key chip + manage */}
      <div className="pt-1 border-t border-border-subtle space-y-3">
        <section className="space-y-1.5">
          <MonoLabel tone="muted">API Key</MonoLabel>
          <div className="relative flex items-center gap-2 px-3 py-2 rounded-[3px] bg-bg-inset border border-border-default text-xs font-mono text-text-primary break-all">
            <span className="flex-1">
              {plaintext ? (revealed ? plaintext : maskKey(plaintext)) : `${active.prefix}…`}
            </span>
            {plaintext && (
              <button
                type="button"
                onClick={() => setRevealed((r) => !r)}
                className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
                title={revealed ? "Hide" : "Reveal"}
              >
                {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            )}
            {plaintext && (
              <button
                type="button"
                onClick={() => copy(plaintext, "key")}
                className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
                title="Copy"
              >
                {copiedId === "key" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
          {!plaintext && (
            <p className="text-[10px] text-text-muted leading-relaxed">
              This key predates encrypted storage and can&apos;t be revealed. Revoke
              and generate a new one to autofill the snippets.
            </p>
          )}
        </section>

        <p className="text-[10px] text-amber-400/60 leading-relaxed">
          Contains your API key. Do not share publicly.
        </p>

        {/* One key at a time: revoke before generating a new one. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void revoke()}
            className="px-2.5 py-1 rounded-[3px] font-mono text-[10px] uppercase tracking-wide border border-border-strong text-text-tertiary hover:bg-surface-raised-3 hover:text-text-primary transition-colors"
          >
            Revoke
          </button>
          <button
            type="button"
            onClick={() => void generate()}
            className="px-2.5 py-1 rounded-[3px] font-mono text-[10px] uppercase tracking-wide border border-border-strong text-text-muted hover:bg-surface-raised-2 transition-colors"
          >
            Generate new
          </button>
          {error && <span className="text-[10px] text-red-400/90">{error}</span>}
        </div>
      </div>
    </div>
  );
}
