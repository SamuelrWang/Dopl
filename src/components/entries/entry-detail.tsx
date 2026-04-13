"use client";

import Link from "next/link";
import { EntryTabs } from "./entry-tabs";
import { MonoLabel } from "@/components/design";

interface EntryDetailProps {
  entry: {
    id: string;
    title: string | null;
    summary: string | null;
    source_url: string;
    source_author: string | null;
    use_case: string | null;
    complexity: string | null;
    status: string;
    readme: string | null;
    agents_md: string | null;
    manifest: Record<string, unknown> | null;
    raw_content: Record<string, unknown> | null;
    created_at: string;
    ingested_at: string | null;
    sources: {
      source_type: string;
      url: string | null;
      raw_content: string | null;
      extracted_content: string | null;
    }[];
    tags: { tag_type: string; tag_value: string }[];
  };
}

const complexityAccent: Record<string, string> = {
  simple: "var(--mint)",
  moderate: "var(--gold)",
  complex: "var(--coral)",
  advanced: "var(--coral)",
};

function extractGitHubRepoUrl(entry: EntryDetailProps["entry"]): string | null {
  // Check if the source URL itself is a GitHub repo
  if (entry.source_url.includes("github.com")) {
    const match = entry.source_url.match(/github\.com\/[^/]+\/[^/\s?#]+/);
    if (match) return `https://${match[0]}`;
  }

  // Check sources for a github_repo type
  const repoSource = entry.sources.find(
    (s) => s.source_type === "github_repo" && s.url
  );
  if (repoSource?.url) return repoSource.url;

  // Check any source URL that's a GitHub link
  for (const source of entry.sources) {
    if (source.url?.includes("github.com")) {
      const match = source.url.match(/github\.com\/[^/]+\/[^/\s?#]+/);
      if (match) return `https://${match[0]}`;
    }
  }

  return null;
}

function OutlineButton({
  href,
  children,
  external = true,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const className =
    "inline-flex h-8 items-center px-3 font-mono text-[10px] uppercase tracking-wide bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.1] hover:border-white/[0.2] rounded-[3px] text-white/70 hover:text-white/90 transition-all";

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function EntryDetail({ entry }: EntryDetailProps) {
  const githubRepoUrl = extractGitHubRepoUrl(entry);
  const complexityColor = entry.complexity
    ? complexityAccent[entry.complexity]
    : undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <MonoLabel tone="muted">Setup Entry</MonoLabel>
            <h1 className="text-2xl font-semibold text-white/95 mt-1 leading-tight">
              {entry.title || "Untitled"}
            </h1>
            {entry.summary && (
              <p className="text-sm text-white/60 mt-2 leading-relaxed max-w-3xl">
                {entry.summary}
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <OutlineButton href={entry.source_url}>View Original</OutlineButton>
            {githubRepoUrl && (
              <OutlineButton href={githubRepoUrl}>GitHub</OutlineButton>
            )}
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-white/[0.06]">
          {entry.source_author && (
            <MonoLabel tone="default">@{entry.source_author}</MonoLabel>
          )}
          {entry.use_case && (
            <MonoLabel tone="muted">
              {entry.use_case.replace(/_/g, " ")}
            </MonoLabel>
          )}
          {entry.complexity && (
            <MonoLabel accentColor={complexityColor} tone="default">
              {entry.complexity}
            </MonoLabel>
          )}
          <span
            className={`font-mono text-[10px] uppercase tracking-wide ${
              entry.status === "complete"
                ? "text-white/60"
                : "text-red-400"
            }`}
          >
            {entry.status}
          </span>
        </div>

        {/* Tags */}
        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {entry.tags.slice(0, 20).map((tag, i) => (
              <span
                key={i}
                className="font-mono text-[9px] uppercase tracking-wide px-2 py-0.5 bg-white/[0.04] border border-white/[0.08] rounded-[3px] text-white/50"
              >
                <span className="text-white/30">{tag.tag_type}:</span>{" "}
                {tag.tag_value}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <EntryTabs
        readme={entry.readme}
        agentsMd={entry.agents_md}
        manifest={entry.manifest}
        rawContent={entry.raw_content}
        sources={entry.sources}
        githubRepoUrl={githubRepoUrl}
      />
    </div>
  );
}
