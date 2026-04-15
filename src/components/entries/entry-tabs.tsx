"use client";

import { useState } from "react";
import { RepoFileBrowser } from "./repo-file-browser";
import { GlassCard, GlassDivider, MonoLabel } from "@/components/design";

interface EntryTabsProps {
  readme: string | null;
  agentsMd: string | null;
  manifest: Record<string, unknown> | null;
  rawContent: Record<string, unknown> | null;
  sources: {
    source_type: string;
    url: string | null;
    raw_content: string | null;
    extracted_content: string | null;
  }[];
  githubRepoUrl: string | null;
  contentType?: string;
}

function getSecondaryLabel(contentType?: string): string {
  switch (contentType) {
    case "knowledge":
    case "article":
      return "Key Insights";
    case "reference":
      return "Reference Guide";
    case "setup":
    case "tutorial":
    default:
      return "agents.md";
  }
}

function getSecondaryFilename(contentType?: string): string {
  switch (contentType) {
    case "knowledge":
    case "article":
      return "key-insights.md";
    case "reference":
      return "reference-guide.md";
    default:
      return "agents.md";
  }
}

type TabId = "readme" | "agents" | "manifest" | "repo" | "raw";

function SharpButton({
  children,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "ghost";
}) {
  const base =
    "inline-flex h-7 items-center px-3 font-mono text-[10px] uppercase tracking-wide rounded-[3px] transition-all";
  const variants = {
    default:
      "bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.1] hover:border-white/[0.2] text-white/70 hover:text-white/90",
    ghost:
      "hover:bg-white/[0.05] border border-transparent hover:border-white/[0.1] text-white/50 hover:text-white/80",
  };
  return (
    <button onClick={onClick} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  );
}

export function EntryTabs({
  readme,
  agentsMd,
  manifest,
  rawContent,
  sources,
  githubRepoUrl,
  contentType,
}: EntryTabsProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("readme");
  const hasRepo = !!githubRepoUrl;
  const secondaryLabel = getSecondaryLabel(contentType);
  const secondaryFilename = getSecondaryFilename(contentType);
  const showSecondaryTab = contentType !== "resource";

  async function copyToClipboard(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  const tabs: { id: TabId; label: string; show: boolean }[] = [
    { id: "readme", label: "README", show: true },
    { id: "agents", label: secondaryLabel, show: showSecondaryTab },
    { id: "manifest", label: "Manifest", show: true },
    { id: "repo", label: "Repository", show: hasRepo },
    { id: "raw", label: "Raw Data", show: true },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar — sharp corners, like openclaw nav */}
      <div className="flex items-center gap-1 p-1 bg-[var(--tabs-surface)] border border-white/[0.08] rounded-[3px] overflow-x-auto">
        {tabs
          .filter((t) => t.show)
          .map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 h-8 px-4 font-mono text-[10px] uppercase tracking-wide rounded-[3px] transition-all ${
                  isActive
                    ? "bg-white/[0.08] text-white/90 border border-white/[0.15]"
                    : "text-white/50 hover:text-white/80 border border-transparent"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
      </div>

      {/* README */}
      {activeTab === "readme" && (
        <GlassCard
          label="README.md"
          labelDivider
          accentColor="var(--mint)"
        >
          <div className="flex justify-end mb-4">
            <SharpButton onClick={() => copyToClipboard(readme || "", "readme")}>
              {copied === "readme" ? "Copied" : "Copy"}
            </SharpButton>
          </div>
          <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-white/80 leading-relaxed">
            {readme || "No README generated yet."}
          </div>
        </GlassCard>
      )}

      {/* Secondary artifact (agents.md / Key Insights / Reference Guide) */}
      {activeTab === "agents" && (
        <GlassCard
          label={secondaryFilename}
          labelDivider
          accentColor="var(--coral)"
        >
          <div className="flex justify-end gap-2 mb-4">
            <SharpButton
              onClick={() => copyToClipboard(agentsMd || "", "agents")}
            >
              {copied === "agents" ? "Copied" : "Copy"}
            </SharpButton>
            <SharpButton
              onClick={() => {
                const blob = new Blob([agentsMd || ""], {
                  type: "text/markdown",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = secondaryFilename;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download
            </SharpButton>
          </div>
          <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-white/80 leading-relaxed">
            {agentsMd || `No ${secondaryLabel.toLowerCase()} generated yet.`}
          </div>
        </GlassCard>
      )}

      {/* Manifest */}
      {activeTab === "manifest" && (
        <GlassCard
          label="manifest.json"
          labelDivider
          accentColor="var(--gold)"
        >
          <div className="flex justify-end mb-4">
            <SharpButton
              onClick={() =>
                copyToClipboard(
                  JSON.stringify(manifest, null, 2),
                  "manifest"
                )
              }
            >
              {copied === "manifest" ? "Copied" : "Copy"}
            </SharpButton>
          </div>
          <pre className="bg-black/[0.3] border border-white/[0.05] rounded-[3px] p-4 overflow-auto text-xs font-mono text-white/80 leading-relaxed">
            {manifest
              ? JSON.stringify(manifest, null, 2)
              : "No manifest generated yet."}
          </pre>
        </GlassCard>
      )}

      {/* Repository */}
      {activeTab === "repo" && hasRepo && (
        <RepoFileBrowser repoUrl={githubRepoUrl!} />
      )}

      {/* Raw Data */}
      {activeTab === "raw" && (
        <GlassCard label={`Sources (${sources.length})`} labelDivider>
          <div className="space-y-4">
            {sources.map((source, i) => (
              <div
                key={i}
                className="border border-white/[0.08] rounded-[3px] p-4 bg-black/[0.15]"
              >
                <div className="flex items-center gap-2 mb-2">
                  <MonoLabel tone="strong">{source.source_type}</MonoLabel>
                  {source.url && (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] uppercase tracking-wide text-white/40 hover:text-white/70 transition-colors truncate"
                    >
                      {source.url}
                    </a>
                  )}
                </div>
                <pre className="bg-black/[0.3] border border-white/[0.05] rounded-[3px] p-3 text-xs font-mono text-white/70 overflow-auto max-h-64 whitespace-pre-wrap break-words">
                  {source.extracted_content ||
                    source.raw_content ||
                    "No content"}
                </pre>
              </div>
            ))}
            {rawContent && (
              <>
                <GlassDivider />
                <div>
                  <MonoLabel tone="strong">Full Raw Content</MonoLabel>
                  <pre className="mt-2 bg-black/[0.3] border border-white/[0.05] rounded-[3px] p-4 text-xs font-mono text-white/70 overflow-auto max-h-96 whitespace-pre-wrap break-words">
                    {JSON.stringify(rawContent, null, 2)}
                  </pre>
                </div>
              </>
            )}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
