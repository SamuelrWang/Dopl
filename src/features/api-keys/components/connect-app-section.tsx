"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "@/shared/ui/toast";

interface Props {
  workspaceSlug: string;
}

export function ConnectAppSection({ workspaceSlug }: Props) {
  const mcpUrl = `https://dopl.run/mcp/${workspaceSlug}`;
  const addCmd = `claude mcp add --scope project --transport http dopl "${mcpUrl}"`;
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
      <p className="text-sm font-medium text-text-primary mb-4">
        Connect your app
      </p>

      <PromptBanner prompt={prompt} />

      <div className="mt-6">
        <Step
          n={1}
          title="Add MCP server"
          description="Add the MCP server to your project config using the command line."
        >
          <CodeRow code={addCmd} />
        </Step>

        <Step
          n={2}
          title="Install Agent Skills (Optional)"
          description="Agent Skills give your agent ready-made instructions, scripts, and resources for working with this workspace more accurately and efficiently."
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
      <p className="text-sm font-medium text-text-primary">
        Give your agent everything it needs
      </p>
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
