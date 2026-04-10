"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
}

interface RepoMeta {
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
}

interface FileContent {
  name: string;
  path: string;
  size: number;
  content: string;
}

const LANG_MAP: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  rb: "Ruby",
  php: "PHP",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  yml: "YAML",
  yaml: "YAML",
  json: "JSON",
  toml: "TOML",
  sql: "SQL",
  md: "Markdown",
  mdx: "Markdown",
  css: "CSS",
  scss: "SCSS",
  html: "HTML",
  xml: "XML",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileLanguage(filename: string): string | null {
  const lower = filename.toLowerCase();
  // Handle special filenames
  if (lower === "dockerfile") return "Dockerfile";
  if (lower === "makefile") return "Makefile";
  const ext = lower.split(".").pop() || "";
  return LANG_MAP[ext] || null;
}

interface RepoFileBrowserProps {
  repoUrl: string; // e.g. "https://github.com/owner/repo"
}

export function RepoFileBrowser({ repoUrl }: RepoFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [meta, setMeta] = useState<RepoMeta | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Extract owner/repo from URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/\s?#]+)/);
  const repoSlug = match ? `${match[1]}/${match[2].replace(/\.git$/, "")}` : null;

  const fetchDirectory = useCallback(
    async (path: string) => {
      if (!repoSlug) return;
      setLoading(true);
      setError(null);
      setFileContent(null);

      try {
        const params = new URLSearchParams({ repo: repoSlug, path, type: "dir" });
        const res = await fetch(`/api/github/contents?${params}`);
        if (!res.ok) throw new Error("Failed to load directory");

        const data = await res.json();
        setEntries(data.entries || []);
        if (data.meta) setMeta(data.meta);
        setCurrentPath(path);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [repoSlug]
  );

  const fetchFile = useCallback(
    async (path: string) => {
      if (!repoSlug) return;
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          repo: repoSlug,
          path,
          type: "file",
        });
        const res = await fetch(`/api/github/contents?${params}`);
        if (!res.ok) throw new Error("Failed to load file");

        const data = await res.json();
        setFileContent(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        setLoading(false);
      }
    },
    [repoSlug]
  );

  // Load root on mount
  useEffect(() => {
    fetchDirectory("");
  }, [fetchDirectory]);

  function handleEntryClick(entry: FileEntry) {
    if (entry.type === "dir") {
      fetchDirectory(entry.path);
    } else {
      // Don't try to render huge files
      if (entry.size > 500_000) {
        setError("File too large to display in browser");
        return;
      }
      fetchFile(entry.path);
    }
  }

  function navigateUp() {
    if (fileContent) {
      // Go back to directory from file view
      const dirPath = fileContent.path.split("/").slice(0, -1).join("/");
      fetchDirectory(dirPath);
      return;
    }
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    fetchDirectory(parts.join("/"));
  }

  function handleCopy() {
    if (!fileContent) return;
    navigator.clipboard.writeText(fileContent.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Build breadcrumbs
  const pathParts = (fileContent?.path || currentPath).split("/").filter(Boolean);

  if (!repoSlug) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          Invalid GitHub URL
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono">{repoSlug}</CardTitle>
          <a
            href={`https://github.com/${repoSlug}/archive/HEAD.zip`}
            className="inline-flex"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm">
              Download ZIP
            </Button>
          </a>
        </div>

        {meta && (
          <div className="flex gap-3 text-xs text-muted-foreground mt-1">
            {meta.language && <span>{meta.language}</span>}
            <span>{meta.stargazers_count} stars</span>
            <span>{meta.forks_count} forks</span>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 px-4 py-2 border-b text-sm overflow-x-auto">
          <button
            onClick={() => {
              setFileContent(null);
              fetchDirectory("");
            }}
            className="text-blue-500 hover:underline font-medium shrink-0"
          >
            {repoSlug.split("/")[1]}
          </button>
          {pathParts.map((part, i) => {
            const fullPath = pathParts.slice(0, i + 1).join("/");
            const isLast = i === pathParts.length - 1;
            return (
              <span key={fullPath} className="flex items-center gap-1 shrink-0">
                <span className="text-muted-foreground">/</span>
                {isLast ? (
                  <span className="font-medium">{part}</span>
                ) : (
                  <button
                    onClick={() => {
                      setFileContent(null);
                      fetchDirectory(fullPath);
                    }}
                    className="text-blue-500 hover:underline"
                  >
                    {part}
                  </button>
                )}
              </span>
            );
          })}
        </div>

        {loading && (
          <div className="p-8 text-center text-muted-foreground">Loading...</div>
        )}

        {error && (
          <div className="p-8 text-center text-red-500">{error}</div>
        )}

        {/* File content view */}
        {!loading && !error && fileContent && (
          <div>
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <button onClick={navigateUp} className="hover:text-foreground">
                  &larr; Back
                </button>
                <span>{formatSize(fileContent.size)}</span>
                {getFileLanguage(fileContent.name) && (
                  <span>{getFileLanguage(fileContent.name)}</span>
                )}
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCopy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre className="p-4 overflow-auto text-xs leading-relaxed max-h-[600px] font-mono">
              <code>
                {fileContent.content.split("\n").map((line, i) => (
                  <div key={i} className="flex">
                    <span className="w-12 shrink-0 text-right pr-4 text-muted-foreground select-none">
                      {i + 1}
                    </span>
                    <span className="whitespace-pre">{line}</span>
                  </div>
                ))}
              </code>
            </pre>
          </div>
        )}

        {/* Directory listing */}
        {!loading && !error && !fileContent && (
          <div className="divide-y">
            {currentPath && (
              <button
                onClick={navigateUp}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/50 text-left"
              >
                <span className="w-5 text-center text-muted-foreground">..</span>
                <span className="text-muted-foreground">(parent directory)</span>
              </button>
            )}
            {entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => handleEntryClick(entry)}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/50 text-left"
              >
                <span className="w-5 text-center shrink-0">
                  {entry.type === "dir" ? (
                    <span className="text-blue-500">d</span>
                  ) : (
                    <span className="text-muted-foreground">f</span>
                  )}
                </span>
                <span
                  className={
                    entry.type === "dir"
                      ? "text-blue-500 font-medium"
                      : "text-foreground"
                  }
                >
                  {entry.name}
                </span>
                {entry.type === "file" && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatSize(entry.size)}
                  </span>
                )}
              </button>
            ))}
            {entries.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">
                Empty directory
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
