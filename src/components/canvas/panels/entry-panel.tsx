"use client";

/**
 * EntryPanelBody — rich viewer for a generated entry, rendered inside a
 * draggable CanvasPanel. Auto-spawned to the right of a chat panel when
 * its ingestion completes.
 *
 * Layout:
 *  - Thumbnail strip (aspect-video) with platform badge overlay
 *  - Preview (title + summary)
 *  - Metadata row (author, use-case, complexity, date)
 *  - Tags row
 *  - Actions row (View Original / Full Entry / GitHub)
 *  - Artifact sections (README / agents.md / manifest) with copy + download
 *
 * Visual language: matches the browse-page EntryCard (same gradients,
 * badges, mono labels) and the canvas's liquid-glass aesthetic.
 */

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { Copy, Check, Download } from "lucide-react";
import { MarkdownMessage, PlatformIcon } from "@/components/design";
import type { EntryPanelData } from "../types";
import type { ProgressEvent } from "@/components/ingest/chat-message";

interface EntryPanelBodyProps {
  panel: EntryPanelData;
}

// ── Platform visual maps (mirrored from entry-card.tsx) ─────────────

const platformLabels: Record<string, string> = {
  x: "X",
  instagram: "IG",
  reddit: "Reddit",
  github: "GitHub",
  youtube: "YouTube",
  hackernews: "HN",
  stackoverflow: "SO",
  medium: "Medium",
  substack: "Substack",
  devto: "Dev.to",
  arxiv: "arXiv",
  web: "Web",
};

function getSecondaryLabel(contentType: string | null | undefined): { label: string; filename: string } {
  switch (contentType) {
    case "knowledge":
    case "article":
      return { label: "Key Insights", filename: "key-insights.md" };
    case "reference":
      return { label: "Reference Guide", filename: "reference-guide.md" };
    default:
      return { label: "agents.md", filename: "agents.md" };
  }
}

const placeholderGradients: Record<string, string> = {
  x: "from-neutral-900 to-black",
  instagram: "from-fuchsia-900 via-pink-900 to-orange-900",
  reddit: "from-orange-900 to-red-950",
  github: "from-neutral-800 to-neutral-900",
  web: "from-slate-900 to-black",
};

// ── Component ───────────────────────────────────────────────────────

export function EntryPanelBody({ panel }: EntryPanelBodyProps) {
  const platform = panel.sourcePlatform || "web";
  const gradientClass =
    placeholderGradients[platform] || placeholderGradients.web;

  const githubRepoUrl = extractGitHubRepoUrl(panel.sourceUrl);

  // Build artifacts array — include tabs in loading state even without content
  const artifacts = useMemo(() => {
    const items: { label: string; filename: string; content: string; accentColor: string; loading: boolean }[] = [];
    if (panel.readme || panel.readmeLoading) {
      items.push({ label: "README.md", filename: "README.md", content: panel.readme, accentColor: "var(--mint)", loading: !!panel.readmeLoading });
    }
    if (panel.agentsMd || panel.agentsMdLoading) {
      const secondary = getSecondaryLabel(panel.contentType);
      items.push({ label: secondary.label, filename: secondary.filename, content: panel.agentsMd, accentColor: "var(--coral)", loading: !!panel.agentsMdLoading });
    }
    if (panel.manifest && Object.keys(panel.manifest).length > 0) {
      items.push({ label: "manifest.json", filename: "manifest.json", content: JSON.stringify(panel.manifest, null, 2), accentColor: "var(--gold)", loading: false });
    }
    return items;
  }, [panel.readme, panel.agentsMd, panel.manifest, panel.readmeLoading, panel.agentsMdLoading]);

  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const active = artifacts[activeTab] ?? artifacts[0];

  function handleCopy() {
    if (!active || typeof navigator === "undefined") return;
    navigator.clipboard.writeText(active.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDownload() {
    if (!active || typeof window === "undefined") return;
    const blob = new Blob([active.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = active.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isIngesting = !!panel.isIngesting;
  const isPendingIngestion = !!panel.isPendingIngestion;
  const isSkeleton =
    (isIngesting || isPendingIngestion) &&
    (!panel.title ||
      panel.title === "Ingesting..." ||
      panel.title.startsWith("Queued"));

  // Stall detection: if we've been loading for 90s without any new
  // ingestion log arriving, something's wrong (server restarted, pipeline
  // wedged, SSE dropped). Surface this to the user so they're not staring
  // at a frozen skeleton forever.
  const [isStalled, setIsStalled] = useState(false);
  const lastLogCountRef = useRef(0);
  useEffect(() => {
    if (!isIngesting) {
      setIsStalled(false);
      return;
    }
    const logCount = panel.ingestionLogs?.length ?? 0;
    // If a new log arrived, reset stall timer
    if (logCount !== lastLogCountRef.current) {
      lastLogCountRef.current = logCount;
      setIsStalled(false);
    }
    const stallTimer = setTimeout(() => setIsStalled(true), 90_000);
    return () => clearTimeout(stallTimer);
  }, [isIngesting, panel.ingestionLogs?.length]);

  // Amber border for the queued-but-not-yet-processing state —
  // distinct from the purple `ingest-glow` animation so "waiting on
  // agent" reads differently from "agent is working". Inline shadow
  // avoids needing a new global keyframe.
  const pendingGlowStyle: React.CSSProperties = {
    boxShadow: "inset 0 0 0 1px rgba(245, 158, 11, 0.3)",
  };

  return (
    <div
      className="flex-1 min-h-0 flex flex-col overflow-hidden"
      style={
        isPendingIngestion
          ? pendingGlowStyle
          : isIngesting
          ? { animation: "ingest-glow 2s ease-in-out infinite" }
          : undefined
      }
    >
      {/* ── Pending-ingestion banner (shown while waiting on agent) ── */}
      {isPendingIngestion && !isIngesting && (
        <div className="shrink-0 bg-amber-500/10 border-b border-amber-500/20 px-3 py-2">
          <p className="text-[11px] text-amber-300/90">
            Queued — your connected MCP agent will pick this up on its next
            tool call. No connected agent?{" "}
            <a
              href="/settings/connections"
              className="underline hover:text-amber-200"
            >
              Connect one
            </a>
            .
          </p>
        </div>
      )}

      {/* ── Stall warning ───────────────────────────────────────── */}
      {isStalled && (
        <div className="shrink-0 bg-amber-500/10 border-b border-amber-500/20 px-3 py-2">
          <p className="text-[11px] text-amber-300/90">
            Ingestion has been running for a while with no updates. It may be
            stuck — try closing this panel and re-ingesting the URL.
          </p>
        </div>
      )}

      {/* ── Ingestion log header (attached on top while generating) ── */}
      {isIngesting && panel.ingestionLogs && panel.ingestionLogs.length > 0 && (
        <IngestionLogHeader logs={panel.ingestionLogs} />
      )}

      {/* ── Skeleton state ───────────────────────────────────────── */}
      {isSkeleton ? (
        <div className="flex-1 flex flex-col gap-4 p-5">
          {/* Thumbnail skeleton */}
          <div className="aspect-video w-full rounded-[3px] bg-purple-500/10 animate-pulse" />
          {/* Title skeleton */}
          <div className="space-y-2">
            <div className="h-5 w-3/4 rounded bg-purple-500/10 animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-purple-500/10 animate-pulse" />
          </div>
          {/* Tab bar skeleton */}
          <div className="flex gap-2 pt-2 border-t border-purple-500/10">
            <div className="h-7 w-20 rounded-[3px] bg-purple-500/10 animate-pulse" />
            <div className="h-7 w-20 rounded-[3px] bg-purple-500/10 animate-pulse" />
            <div className="h-7 w-24 rounded-[3px] bg-purple-500/10 animate-pulse" />
          </div>
          {/* Content skeleton */}
          <div className="flex-1 rounded-[3px] bg-purple-500/10 animate-pulse" />
        </div>
      ) : (
      <>
      {/* ── Thumbnail strip ───────────────────────────────────────── */}
      <div className="relative aspect-video overflow-hidden group/thumb shrink-0">
        {panel.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={panel.thumbnailUrl}
            alt={panel.title || "Entry thumbnail"}
            className="w-full h-full object-cover group-hover/thumb:scale-[1.02] transition-transform duration-300"
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = "none";
              const fallback = target.nextElementSibling as HTMLElement | null;
              if (fallback) fallback.style.display = "flex";
            }}
          />
        ) : null}
        <div
          className={`w-full h-full bg-gradient-to-br ${gradientClass} flex items-center justify-center ${panel.thumbnailUrl ? "hidden" : ""}`}
        >
          <span className="font-mono text-3xl font-bold text-white/20 uppercase tracking-widest">
            {platformLabels[platform] || "Dopl"}
          </span>
        </div>

        {/* Platform badge — top left, clickable to open source */}
        <a
          href={panel.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 left-2 flex items-center justify-center w-7 h-7 bg-[oklch(0.07_0_0)] border border-white/10 rounded-[3px] text-white/80 hover:text-white hover:bg-black/80 transition-colors"
          title={`Open on ${platformLabels[platform] || "Web"}`}
        >
          <PlatformIcon platform={platform} />
        </a>
      </div>

      {/* ── Title + Summary + Actions ─────────────────────────────── */}
      <div className="px-5 pt-4 pb-3 space-y-2.5 shrink-0">
        <div className="space-y-1.5">
          <h2 className="text-base font-medium text-white/95 line-clamp-2 leading-snug">
            {panel.title}
          </h2>
          {panel.summary && (
            <p className="text-xs text-white/55 line-clamp-2 leading-relaxed">
              {panel.summary}
            </p>
          )}
        </div>

      </div>

      {/* ── Tab bar + actions ─────────────────────────────────────── */}
      {artifacts.length > 0 && (
        <div className="px-5 py-2 flex items-center gap-2 border-t border-white/[0.06] shrink-0">
          {artifacts.map((art, i) => (
            <button
              key={art.label}
              onClick={() => { setActiveTab(i); setCopied(false); }}
              className={`inline-flex h-7 items-center px-3 font-mono text-[10px] uppercase tracking-wide rounded-[3px] transition-colors border ${
                i === activeTab
                  ? "bg-white/[0.09] border-white/[0.22] text-white/95"
                  : "bg-white/[0.04] border-white/[0.08] text-white/50 hover:bg-white/[0.07] hover:text-white/70"
              }`}
              style={i === activeTab ? { borderBottomColor: art.accentColor } : undefined}
            >
              {art.label}
            </button>
          ))}
          <OutlineButton href={`/entries/${panel.entryId}`}>
            Full Entry
          </OutlineButton>
          {githubRepoUrl && (
            <OutlineButton href={githubRepoUrl} external>
              GitHub
            </OutlineButton>
          )}
        </div>
      )}

      {/* ── File viewport (scrolls independently) ─────────────────── */}
      {active && (
        <div className="flex-1 min-h-0 px-5 pb-4 pt-1 relative">
          {active.loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 bg-black/[0.3] border border-white/[0.08] rounded-[3px]">
              <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              <span className="text-xs font-mono text-white/40">Generating...</span>
            </div>
          ) : (
            <>
              {/* Inline icon actions — top right of viewport */}
              <div className="absolute top-3 right-7 z-10 flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="text-white/30 hover:text-white/70 transition-colors"
                  title="Copy"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={handleDownload}
                  className="text-white/30 hover:text-white/70 transition-colors"
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
              {active.filename.endsWith(".md") ? (
                <div className="h-full overflow-y-auto bg-black/[0.3] border border-white/[0.08] rounded-[3px] p-3 pt-4">
                  <MarkdownMessage content={active.content} />
                </div>
              ) : (
                <pre className="h-full overflow-y-auto text-[10px] font-mono bg-black/[0.3] border border-white/[0.08] rounded-[3px] p-3 pt-4 text-white/70 leading-relaxed whitespace-pre-wrap break-words">
                  {active.content}
                </pre>
              )}
            </>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ── Ingestion log header ──────────────────────────────────────────

function IngestionLogHeader({ logs }: { logs: ProgressEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  const iconFor = (type: string) => {
    switch (type) {
      case "step_start": return ">>";
      case "step_complete": return "OK";
      case "error":
      case "step_error": return "!!";
      case "complete": return "**";
      default: return "->";
    }
  };

  return (
    <div
      ref={scrollRef}
      className="max-h-[80px] overflow-y-auto border-b border-purple-500/20 bg-purple-950/20 px-3 py-2 shrink-0"
    >
      {logs.map((log, i) => (
        <div key={i} className="flex items-start gap-1.5 text-[9px] font-mono leading-tight">
          <span className="text-purple-400/60 shrink-0 w-4 text-right">{iconFor(log.type)}</span>
          <span className="text-white/50 truncate">{log.message}</span>
        </div>
      ))}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

interface OutlineButtonProps {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}

function OutlineButton({ href, external, children }: OutlineButtonProps) {
  const className =
    "inline-flex h-7 items-center px-3 font-mono text-[10px] uppercase tracking-wide bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.12] hover:border-white/[0.22] rounded-[3px] text-white/70 hover:text-white/95 transition-colors";

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} target="_blank" className={className}>
      {children}
    </Link>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Detect a GitHub repo URL in the entry's source URL. For v1 we only check
 * the top-level source URL (not nested sources), matching the user's
 * "minimal — just a View on GitHub link" preference.
 */
function extractGitHubRepoUrl(sourceUrl: string): string | null {
  if (!sourceUrl.includes("github.com")) return null;
  const match = sourceUrl.match(/github\.com\/[^/]+\/[^/\s?#]+/);
  if (!match) return null;
  return `https://${match[0]}`;
}
