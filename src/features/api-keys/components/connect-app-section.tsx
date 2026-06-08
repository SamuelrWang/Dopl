"use client";

/**
 * "Connect your app" stepper for the workspace overview.
 *
 * Restored from the original stepper UI, rewired to the unified key
 * logic: exactly one workspace-scoped key per (user, workspace), stored
 * encrypted and REVEALED here so the `claude mcp add` command is always
 * copy-ready with the real key inlined. To rotate, revoke first.
 */

import { useEffect, useState } from "react";
import { Copy, Key as KeyIcon, Eye, EyeOff } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { useWorkspaceKey } from "../hooks/use-workspace-key";
import { RemoteConnect } from "./remote-connect";

interface Props {
  workspaceSlug: string;
}

function maskKey(key: string): string {
  if (key.length <= 8) return key;
  return key.slice(0, 8) + "••••••••••••••••";
}

export function ConnectAppSection({ workspaceSlug }: Props) {
  const { active, plaintext, isLoading, generate, rotate, error } =
    useWorkspaceKey(workspaceSlug);
  const [revealed, setRevealed] = useState(false);

  // Real key when we have it; otherwise a visible placeholder.
  const keyForCommand = plaintext ?? "<YOUR_API_KEY>";
  const addCmd = `claude mcp add dopl --scope user --transport stdio -- npx @dopl/mcp-server --api-key ${keyForCommand}`;

  const [origin, setOrigin] = useState<string>("");
  useEffect(() => {
    // Read the live origin only after mount so SSR and first client
    // render agree (no hydration mismatch on the URL text below).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  const mcpServerUrl = `${origin || "https://www.usedopl.com"}/api/mcp`;
  const skillsCmd = `npx dopl skill install <name>`;

  const prompt = [
    `You have access to my Dopl workspace at /${workspaceSlug}.`,
    "",
    "Set yourself up:",
    `1. Run: ${addCmd}`,
    `2. (Optional) Run: ${skillsCmd}`,
    "",
    "Then use the dopl MCP tools to read/write knowledge entries, manage skills, and update the canvas.",
  ].join("\n");

  return (
    <section className="rounded-2xl border border-border-default bg-[var(--panel-surface)] p-5">
      <p className="text-sm font-medium text-text-primary mb-1">
        Connect your app
      </p>
      <p className="text-xs text-text-secondary mb-4">
        Connect any MCP client to this workspace. The recommended way needs no
        API key — you log in once and updates roll out automatically.
      </p>

      <RemoteConnect />

      <details className="mt-4">
        <summary className="cursor-pointer text-[11px] text-text-secondary hover:text-text-primary transition-colors">
          Or use an API key instead (offline / CI / legacy)
        </summary>
        <div className="mt-4">

      <PromptBanner prompt={prompt} />

      <div className="mt-6">
        <Step
          n={1}
          title="Your workspace API key"
          description="Lets your local MCP server authenticate as you. One key per workspace — already inlined in the command below."
        >
          {isLoading ? (
            <p className="text-[11px] text-text-secondary">Loading…</p>
          ) : plaintext ? (
            <div className="space-y-2">
              <div className="rounded-md border border-violet-400/40 bg-violet-500/[0.06] p-3 flex items-center gap-2">
                <KeyIcon size={12} className="text-violet-300/90 shrink-0" />
                <code className="flex-1 truncate font-mono text-[12px] text-text-primary">
                  {revealed ? plaintext : maskKey(plaintext)}
                </code>
                <button
                  type="button"
                  onClick={() => setRevealed((r) => !r)}
                  className="shrink-0 text-text-secondary hover:text-text-primary transition-colors"
                  title={revealed ? "Hide" : "Reveal"}
                >
                  {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <CopyButton value={plaintext} compact />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void rotate()}
                  className="text-[11px] text-text-secondary hover:text-red-400/90 transition-colors cursor-pointer"
                >
                  Revoke &amp; rotate
                </button>
                {error && (
                  <span className="text-[11px] text-red-400 leading-snug">{error}</span>
                )}
              </div>
            </div>
          ) : active ? (
            <div className="space-y-2">
              <div className="rounded-md border border-border-default bg-surface-raised-1 p-3 flex items-center gap-2">
                <KeyIcon size={12} className="text-text-secondary shrink-0" />
                <code className="flex-1 truncate font-mono text-[12px] text-text-secondary">
                  {active.prefix}…
                </code>
              </div>
              <p className="text-[11px] text-text-secondary leading-snug">
                This key predates encrypted storage and can&rsquo;t be shown.{" "}
                <button
                  type="button"
                  onClick={() => void rotate()}
                  className="text-violet-300/90 hover:underline cursor-pointer"
                >
                  Revoke &amp; generate a new one
                </button>{" "}
                to autofill the command.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void generate()}
                className="h-8 px-3 rounded-md bg-surface-cta text-text-on-cta text-xs font-medium hover:bg-surface-cta/90 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <KeyIcon size={11} />
                Generate API key
              </button>
              {error && <p className="text-[11px] text-red-400 leading-snug">{error}</p>}
            </div>
          )}
        </Step>

        <Step
          n={2}
          title="Add MCP server"
          description={
            plaintext
              ? "Paste this into your terminal. Your API key is already inlined."
              : "Paste into a terminal. Replace <YOUR_API_KEY> with the key from step 1."
          }
        >
          <CodeRow code={addCmd} />
        </Step>

        <Step
          n={3}
          title="Or connect from Claude.ai (custom connector)"
          description="Use this URL in Claude.ai's “Add custom connector” dialog, or any MCP client that takes a remote server URL."
        >
          <div className="space-y-1.5">
            <p className="text-[11px] text-text-secondary leading-snug">
              MCP server URL
            </p>
            <CodeRow code={mcpServerUrl} />
          </div>
        </Step>

        <Step
          n={4}
          title="Install Agent Skills (Optional)"
          description="Skills give your agent ready-made instructions and resources for working with this workspace more accurately."
          last
        >
          <CodeRow code={skillsCmd} />
        </Step>
      </div>
        </div>
      </details>
    </section>
  );
}

function PromptBanner({ prompt }: { prompt: string }) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-raised-1 p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">
          Give your agent everything it needs
        </p>
        <p className="text-[11px] text-text-secondary mt-0.5">
          The prompt includes your API key, ready to paste.
        </p>
      </div>
      <CopyButton value={prompt} label="Copy prompt" />
    </div>
  );
}

interface StepProps {
  n: number;
  title: string;
  description: string;
  last?: boolean;
  children: React.ReactNode;
}

function Step({ n, title, description, last, children }: StepProps) {
  return (
    <div className="relative flex gap-4 pb-6 last:pb-0">
      {!last && (
        <span className="absolute left-3 top-7 bottom-0 w-px bg-surface-raised-3" />
      )}
      <div className="shrink-0 w-6 h-6 rounded-md border border-border-default bg-surface-raised-2 flex items-center justify-center text-[11px] text-text-secondary font-mono z-10">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        <p className="mt-0.5 text-xs text-text-secondary leading-relaxed">
          {description}
        </p>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

function CodeRow({ code }: { code: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border-default bg-bg-inset px-3 py-2">
      <code className="flex-1 truncate font-mono text-[12px] text-text-primary">
        {code}
      </code>
      <CopyButton value={code} compact />
    </div>
  );
}

function CopyButton({
  value,
  label,
  compact,
}: {
  value: string;
  label?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        toast({ title: "Copied to clipboard" });
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        toast({ title: "Couldn't copy" });
      });
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={
        "shrink-0 flex items-center gap-1.5 rounded-md border border-border-default bg-surface-raised-2 hover:bg-surface-raised-4 hover:text-text-primary transition-colors cursor-pointer " +
        (compact
          ? "px-1.5 py-1 text-[10px] text-text-secondary"
          : "px-2.5 py-1.5 text-[11px] text-text-secondary")
      }
    >
      <Copy size={11} />
      {label && (copied ? "Copied" : label)}
    </button>
  );
}
