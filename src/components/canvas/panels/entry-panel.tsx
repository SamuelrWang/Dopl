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
  const isSkeleton = isIngesting && (!panel.title || panel.title === "Ingesting...");

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

  return (
    <div
      className="flex-1 min-h-0 flex flex-col overflow-hidden"
      style={isIngesting ? { animation: "ingest-glow 2s ease-in-out infinite" } : undefined}
    >
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
              <pre className="h-full overflow-y-auto text-[10px] font-mono bg-black/[0.3] border border-white/[0.08] rounded-[3px] p-3 pt-4 text-white/70 leading-relaxed whitespace-pre-wrap break-words">
                {active.content}
              </pre>
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

// ── Platform icons (inline SVGs for brand logos) ──────────────────

function PlatformIcon({ platform }: { platform: string }) {
  const cls = "w-4 h-4 fill-current";
  switch (platform) {
    case "x":
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "github":
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
        </svg>
      );
    case "reddit":
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 000-.463.327.327 0 00-.462 0c-.545.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.205-.094z" />
        </svg>
      );
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      );
    default: // web
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
      );
  }
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
