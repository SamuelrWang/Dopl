"use client";

/**
 * DetailPanel — floating right-side overlay on the published cluster
 * detail page. Visually matches `FixedChatPanel` on /canvas:
 *   - Rounded 2xl, soft inset-top highlight, hard drop shadow
 *   - Detached from viewport edges (the shell positions it with a
 *     16px gap on all sides), not flush
 *   - Mono/micro font scale matching the canvas panel chrome —
 *     [10px] uppercase headers, [11px] primary text, [9px] meta
 *
 * Shows cluster info, creator profile, entries list, brain summary,
 * and the import CTA button. The Chat tab delegates to CommunityChat
 * (unchanged).
 */

import { useState } from "react";
import Link from "next/link";
import type { PublishedClusterDetail } from "@/lib/community/types";
import { CommunityChat } from "./community-chat";

type Tab = "info" | "chat";

interface DetailPanelProps {
  cluster: PublishedClusterDetail;
  isOwner: boolean;
}

export function DetailPanel({ cluster, isOwner }: DetailPanelProps) {
  const [forking, setForking] = useState(false);
  const [forked, setForked] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("info");

  async function handleFork() {
    setForking(true);
    try {
      const res = await fetch(`/api/community/${cluster.slug}/fork`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        if (res.status === 401) {
          window.location.href = `/login?redirect=/community/${cluster.slug}`;
          return;
        }
        throw new Error(data.error || "Failed to import");
      }
      setForked(true);
    } catch {
      // Non-fatal — a toast could surface this later.
    } finally {
      setForking(false);
    }
  }

  return (
    <div
      className="h-full flex flex-col overflow-hidden rounded-2xl bg-[var(--panel-surface)] border border-white/[0.08]"
      style={{
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* ── Top bar (mirrors FixedChatPanel chrome) ────────────────── */}
      <div
        className="shrink-0 h-10 flex items-center justify-between px-4 gap-2"
        style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-wider text-white/50 truncate min-w-0">
          {cluster.title}
        </span>
        {isOwner && (
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-amber-400/70 bg-amber-400/[0.08] border border-amber-400/[0.15] px-1.5 py-0.5 rounded-[3px]">
            Editing
          </span>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex"
        style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}
      >
        <TabButton
          active={activeTab === "info"}
          onClick={() => setActiveTab("info")}
        >
          Info
        </TabButton>
        <TabButton
          active={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
        >
          Chat
        </TabButton>
      </div>

      {/* ── Body ──────────────────────────────────────────────────── */}
      {activeTab === "chat" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <CommunityChat cluster={cluster} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <InfoBody
            cluster={cluster}
            isOwner={isOwner}
            forking={forking}
            forked={forked}
            onFork={handleFork}
          />
        </div>
      )}
    </div>
  );
}

// ── Tab button (FixedChatPanel-style) ─────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 h-9 font-mono text-[10px] uppercase tracking-wider transition-colors ${
        active
          ? "text-white/90 bg-white/[0.04]"
          : "text-white/30 hover:text-white/60 hover:bg-white/[0.02]"
      }`}
      style={
        active
          ? { boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.25)" }
          : undefined
      }
    >
      {children}
    </button>
  );
}

// ── Info body ─────────────────────────────────────────────────────────

function InfoBody({
  cluster,
  isOwner,
  forking,
  forked,
  onFork,
}: {
  cluster: PublishedClusterDetail;
  isOwner: boolean;
  forking: boolean;
  forked: boolean;
  onFork: () => void;
}) {
  return (
    <div className="px-4 py-4 space-y-5">
      {/* Title + description (compact, matches canvas-panel scale) */}
      <div>
        <h1 className="text-sm font-medium text-white/90 leading-snug mb-1.5">
          {cluster.title}
        </h1>
        {cluster.description && (
          <p className="text-[11px] text-white/50 leading-relaxed">
            {cluster.description}
          </p>
        )}
      </div>

      {/* Stats row — all mono, muted */}
      <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider text-white/30">
        <div className="flex items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm3-8.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
          </svg>
          <span>{cluster.fork_count} imports</span>
        </div>
        <span className="text-white/20">·</span>
        <span>{cluster.panel_count} entries</span>
        {cluster.category && (
          <>
            <span className="text-white/20">·</span>
            <span>{cluster.category}</span>
          </>
        )}
      </div>

      {/* Creator */}
      <div
        className="p-3 rounded-[4px] border border-white/[0.06] bg-white/[0.02]"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}
      >
        <div className="flex items-center gap-2.5 mb-2">
          {cluster.author.avatar_url ? (
            <img
              src={cluster.author.avatar_url}
              alt=""
              className="w-7 h-7 rounded-full"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-neutral-700 flex items-center justify-center text-white/40 text-[11px] font-medium">
              {(cluster.author.display_name || "?")[0]?.toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-white/80 font-medium truncate">
              {cluster.author.display_name || "Anonymous"}
            </div>
            {cluster.author.bio && (
              <div className="text-[10px] text-white/30 line-clamp-1">
                {cluster.author.bio}
              </div>
            )}
          </div>
        </div>
        {(cluster.author.website_url ||
          cluster.author.twitter_handle ||
          cluster.author.github_username) && (
          <div className="flex items-center gap-3 flex-wrap">
            {cluster.author.website_url && (
              <a
                href={cluster.author.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[9px] uppercase tracking-wider text-white/30 hover:text-white/70 transition-colors"
              >
                Website
              </a>
            )}
            {cluster.author.twitter_handle && (
              <a
                href={`https://x.com/${cluster.author.twitter_handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[9px] uppercase tracking-wider text-white/30 hover:text-white/70 transition-colors"
              >
                @{cluster.author.twitter_handle}
              </a>
            )}
            {cluster.author.github_username && (
              <a
                href={`https://github.com/${cluster.author.github_username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[9px] uppercase tracking-wider text-white/30 hover:text-white/70 transition-colors"
              >
                GitHub
              </a>
            )}
          </div>
        )}
      </div>

      {/* CTA */}
      {!isOwner ? (
        <button
          onClick={onFork}
          disabled={forking || forked}
          className="w-full h-9 rounded-[4px] bg-white text-black text-[11px] font-medium uppercase tracking-wider hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {forked
            ? "Imported to canvas"
            : forking
              ? "Importing..."
              : "Import to my canvas"}
        </button>
      ) : (
        <Link
          href="/community/posts"
          className="w-full h-9 flex items-center justify-center rounded-[4px] border border-white/[0.1] text-white/60 text-[11px] font-medium uppercase tracking-wider hover:text-white/90 hover:border-white/[0.2] transition-colors"
        >
          Manage posts
        </Link>
      )}

      {/* Entries */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-2">
          Entries ({cluster.entries.length})
        </div>
        <div className="space-y-1.5">
          {cluster.entries.map((entry) => (
            <div
              key={entry.entry_id}
              className="px-3 py-2 rounded-[4px] border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
            >
              <div className="text-[11px] text-white/80 font-medium line-clamp-1 leading-snug">
                {entry.title || "Untitled"}
              </div>
              {entry.summary && (
                <div className="mt-0.5 text-[10px] text-white/35 line-clamp-2 leading-snug">
                  {entry.summary}
                </div>
              )}
              {entry.source_platform && (
                <span className="inline-block mt-1 font-mono text-[9px] uppercase tracking-wider text-white/25">
                  {entry.source_platform}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Brain */}
      {cluster.brain_instructions && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-2">
            Cluster brain
          </div>
          <div
            className="p-3 rounded-[4px] border border-white/[0.05] bg-white/[0.02] text-[10px] text-white/45 leading-relaxed whitespace-pre-wrap line-clamp-[12]"
          >
            {cluster.brain_instructions.slice(0, 500)}
            {cluster.brain_instructions.length > 500 && "..."}
          </div>
        </div>
      )}

      {/* Date */}
      <div
        className="pt-3 font-mono text-[9px] uppercase tracking-wider text-white/25"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
      >
        Published{" "}
        {new Date(cluster.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </div>
    </div>
  );
}
