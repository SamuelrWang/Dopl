"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntryTabs } from "./entry-tabs";
import Link from "next/link";

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

function extractGitHubRepoUrl(entry: EntryDetailProps["entry"]): string | null {
  // Check if the source URL itself is a GitHub repo
  if (entry.source_url.includes("github.com")) {
    const match = entry.source_url.match(
      /github\.com\/[^/]+\/[^/\s?#]+/
    );
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

export function EntryDetail({ entry }: EntryDetailProps) {
  const githubRepoUrl = extractGitHubRepoUrl(entry);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {entry.title || "Untitled"}
            </h1>
            <p className="text-muted-foreground mt-1">{entry.summary}</p>
          </div>
          <div className="flex gap-2">
            <Link href={entry.source_url} target="_blank">
              <Button variant="outline" size="sm">
                View Original
              </Button>
            </Link>
            {githubRepoUrl && (
              <a
                href={githubRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">
                  GitHub
                </Button>
              </a>
            )}
          </div>
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap gap-2 mt-4">
          {entry.source_author && (
            <Badge variant="secondary">@{entry.source_author}</Badge>
          )}
          {entry.use_case && (
            <Badge variant="outline">
              {entry.use_case.replace(/_/g, " ")}
            </Badge>
          )}
          {entry.complexity && <Badge>{entry.complexity}</Badge>}
          <Badge
            variant={
              entry.status === "complete" ? "default" : "destructive"
            }
          >
            {entry.status}
          </Badge>
        </div>

        {/* Tags */}
        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {entry.tags.map((tag, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
                {tag.tag_type}: {tag.tag_value}
              </Badge>
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
