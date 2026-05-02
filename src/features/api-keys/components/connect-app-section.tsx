"use client";

/**
 * Self-contained "Connect your app" stepper for first-time MCP setup.
 *
 * Why it exists alongside `WorkspaceKeysSection`:
 *   - That section is a key-management view (list, revoke, name).
 *   - This section is the "I just signed up, walk me through it"
 *     experience: generate a key inline, see the exact `claude mcp add`
 *     command with the key already substituted, copy + paste.
 *
 * Auth model:
 *   - The MCP server is `@dopl/mcp-server` (published to npm).
 *   - It runs locally over stdio and authenticates via the
 *     `--api-key sk-dopl-...` flag.
 *   - Keys are workspace-scoped and inherit the caller's role inside
 *     that workspace. The /api/workspaces/[slug]/keys endpoint mints
 *     them; the plaintext is shown ONCE at creation time and never
 *     stored client-side beyond this session.
 */

import { useEffect, useState } from "react";
import { Copy, Key as KeyIcon } from "lucide-react";
import { toast } from "@/shared/ui/toast";

interface Props {
  workspaceSlug: string;
}

export function ConnectAppSection({ workspaceSlug }: Props) {
  // Plaintext of the just-generated key. Only set during this session;
  // disappears on refresh. The user must copy it now.
  const [apiKey, setApiKey] = useState<string | null>(null);
  // Whether the workspace already has at least one un-revoked key.
  // Drives the "Generate" vs "Generate new key" CTA copy.
  const [hasExistingKey, setHasExistingKey] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workspaces/${workspaceSlug}/keys`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        const active = ((body.keys ?? []) as Array<{ revoked_at: string | null }>)
          .filter((k) => !k.revoked_at);
        setHasExistingKey(active.length > 0);
      })
      .catch(() => {
        if (!cancelled) setHasExistingKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  async function handleGenerate() {
    setGenerating(true);
    setKeyError(null);
    try {
      const name = `Connect setup · ${new Date().toLocaleDateString()}`;
      const res = await fetch(`/api/workspaces/${workspaceSlug}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error?.message ?? body?.error ?? "Failed");
      }
      setApiKey(body.key as string);
      setHasExistingKey(true);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Couldn't generate key");
    } finally {
      setGenerating(false);
    }
  }

  // Use the freshly-generated key when available; otherwise leave a
  // visible placeholder the user knows to swap.
  const keyForCommand = apiKey ?? "<YOUR_API_KEY>";
  const addCmd = `claude mcp add dopl --scope user --transport stdio -- npx @dopl/mcp-server --api-key ${keyForCommand}`;
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
    <section className="rounded-2xl border border-white/[0.1] bg-[var(--panel-surface)] p-5">
      <p className="text-sm font-medium text-text-primary mb-1">
        Connect your app
      </p>
      <p className="text-xs text-text-secondary mb-4">
        First-time MCP setup. Generate a workspace API key, then paste the
        command into Claude Code — or hand the prompt to your agent and let
        it set itself up.
      </p>

      <PromptBanner prompt={prompt} />

      <div className="mt-6">
        <Step
          n={1}
          title="Generate workspace API key"
          description="Lets your local MCP server authenticate as you. Shown once — copy it now."
        >
          {apiKey ? (
            <div className="rounded-md border border-violet-400/40 bg-violet-500/[0.06] p-3 flex items-center gap-2">
              <KeyIcon size={12} className="text-violet-300/90 shrink-0" />
              <code className="flex-1 truncate font-mono text-[12px] text-text-primary">
                {apiKey}
              </code>
              <CopyButton value={apiKey} compact />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="h-8 px-3 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 disabled:opacity-40 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <KeyIcon size={11} />
                {generating
                  ? "Generating…"
                  : hasExistingKey
                    ? "Generate new key"
                    : "Generate API key"}
              </button>
              {hasExistingKey && (
                <p className="text-[11px] text-text-secondary leading-snug">
                  You already have keys above. Use one of those if you saved
                  the plaintext, otherwise generate a fresh one here.
                </p>
              )}
              {keyError && (
                <p className="text-[11px] text-red-400 leading-snug">
                  {keyError}
                </p>
              )}
            </div>
          )}
        </Step>

        <Step
          n={2}
          title="Add MCP server"
          description={
            apiKey
              ? "Paste this into your terminal. Your API key is already inlined."
              : "Paste into a terminal. Replace <YOUR_API_KEY> with the key from step 1."
          }
        >
          <CodeRow code={addCmd} />
        </Step>

        <Step
          n={3}
          title="Install Agent Skills (Optional)"
          description="Skills give your agent ready-made instructions and resources for working with this workspace more accurately."
          last
        >
          <CodeRow code={skillsCmd} />
        </Step>
      </div>
    </section>
  );
}

function PromptBanner({ prompt }: { prompt: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">
          Give your agent everything it needs
        </p>
        <p className="text-[11px] text-text-secondary mt-0.5">
          Generate a key first so it&rsquo;s included in the prompt.
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
        <span className="absolute left-3 top-7 bottom-0 w-px bg-white/[0.08]" />
      )}
      <div className="shrink-0 w-6 h-6 rounded-md border border-white/[0.1] bg-white/[0.04] flex items-center justify-center text-[11px] text-text-secondary font-mono z-10">
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
    <div className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-black/30 px-3 py-2">
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
        "shrink-0 flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] hover:text-text-primary transition-colors cursor-pointer " +
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
