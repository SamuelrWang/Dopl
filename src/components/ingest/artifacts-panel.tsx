"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownMessage } from "@/components/design";

interface ArtifactsPanelProps {
  entryId: string;
  title: string;
  readme: string;
  agentsMd: string;
  manifest: Record<string, unknown>;
}

interface ArtifactSectionProps {
  label: string;
  filename: string;
  content: string;
  language?: string;
}

function ArtifactSection({ label, filename, content, language }: ArtifactSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasMore = content.split("\n").length > 5;
  const isMarkdown = language === "markdown";

  function handleCopy() {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const heightClass = expanded ? "max-h-[400px]" : "max-h-[120px]";

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 text-xs">
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDownload} className="h-7 text-xs">
            Download
          </Button>
        </div>
      </div>
      {isMarkdown ? (
        <div className={`bg-black/30 rounded p-2 overflow-y-auto ${heightClass}`}>
          <MarkdownMessage content={content} />
        </div>
      ) : (
        <pre className={`text-xs bg-black/30 rounded p-2 overflow-x-auto ${heightClass} overflow-y-auto`}>
          <code className={language ? `language-${language}` : ""}>
            {content}
          </code>
        </pre>
      )}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Show less" : "Show more..."}
        </button>
      )}
    </div>
  );
}

export function ArtifactsPanel({
  entryId,
  title,
  readme,
  agentsMd,
  manifest,
}: ArtifactsPanelProps) {
  const manifestStr = JSON.stringify(manifest, null, 2);

  return (
    <Card className="border-green-500/30 bg-green-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          Generated: {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {readme && (
          <ArtifactSection
            label="README.md"
            filename="README.md"
            content={readme}
            language="markdown"
          />
        )}
        {agentsMd && (
          <ArtifactSection
            label="agents.md"
            filename="agents.md"
            content={agentsMd}
            language="markdown"
          />
        )}
        {manifest && Object.keys(manifest).length > 0 && (
          <ArtifactSection
            label="manifest.json"
            filename="manifest.json"
            content={manifestStr}
            language="json"
          />
        )}
        <Link href={`/entries/${entryId}`}>
          <Button variant="outline" size="sm" className="w-full mt-2">
            View full entry
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
