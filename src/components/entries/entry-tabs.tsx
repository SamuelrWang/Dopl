"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RepoFileBrowser } from "./repo-file-browser";

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
}

export function EntryTabs({
  readme,
  agentsMd,
  manifest,
  rawContent,
  sources,
  githubRepoUrl,
}: EntryTabsProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const hasRepo = !!githubRepoUrl;

  async function copyToClipboard(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Tabs defaultValue="readme">
      <TabsList className={`grid w-full ${hasRepo ? "grid-cols-5" : "grid-cols-4"}`}>
        <TabsTrigger value="readme">README</TabsTrigger>
        <TabsTrigger value="agents">agents.md</TabsTrigger>
        <TabsTrigger value="manifest">Manifest</TabsTrigger>
        {hasRepo && <TabsTrigger value="repo">Repository</TabsTrigger>}
        <TabsTrigger value="raw">Raw Data</TabsTrigger>
      </TabsList>

      <TabsContent value="readme">
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-end mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(readme || "", "readme")}
              >
                {copied === "readme" ? "Copied!" : "Copy"}
              </Button>
            </div>
            <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">
              {readme || "No README generated yet."}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="agents">
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-end gap-2 mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(agentsMd || "", "agents")}
              >
                {copied === "agents" ? "Copied!" : "Copy"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const blob = new Blob([agentsMd || ""], {
                    type: "text/markdown",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "agents.md";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download
              </Button>
            </div>
            <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">
              {agentsMd || "No agents.md generated yet."}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="manifest">
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-end mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  copyToClipboard(
                    JSON.stringify(manifest, null, 2),
                    "manifest"
                  )
                }
              >
                {copied === "manifest" ? "Copied!" : "Copy"}
              </Button>
            </div>
            <pre className="bg-muted p-4 rounded-lg overflow-auto text-sm">
              {manifest
                ? JSON.stringify(manifest, null, 2)
                : "No manifest generated yet."}
            </pre>
          </CardContent>
        </Card>
      </TabsContent>

      {hasRepo && (
        <TabsContent value="repo">
          <RepoFileBrowser repoUrl={githubRepoUrl!} />
        </TabsContent>
      )}

      <TabsContent value="raw">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <h3 className="font-semibold">Sources ({sources.length})</h3>
            {sources.map((source, i) => (
              <div key={i} className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-sm">
                    {source.source_type}
                  </span>
                  {source.url && (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {source.url}
                    </a>
                  )}
                </div>
                <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-64">
                  {source.extracted_content ||
                    source.raw_content ||
                    "No content"}
                </pre>
              </div>
            ))}
            {rawContent && (
              <div>
                <h3 className="font-semibold mt-4">Full Raw Content</h3>
                <pre className="bg-muted p-4 rounded-lg overflow-auto text-xs max-h-96">
                  {JSON.stringify(rawContent, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
