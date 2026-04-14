"use client";

/**
 * DetailPanel — fixed right panel on the published cluster detail page.
 * Shows cluster info, creator profile, entries list, brain summary,
 * and the import CTA button.
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
          // Redirect to login
          window.location.href = `/login?redirect=/community/${cluster.slug}`;
          return;
        }
        throw new Error(data.error || "Failed to import");
      }
      setForked(true);
    } catch {
      // Could show error toast
    } finally {
      setForking(false);
    }
  }

  return (
    <div className="w-[380px] flex-shrink-0 border-l border-white/[0.06] bg-[#0a0a0a] flex flex-col">
      {/* Tab bar */}
      <div className="flex-shrink-0 flex border-b border-white/[0.06]">
        <button
          onClick={() => setActiveTab("info")}
          className={`flex-1 h-10 text-xs font-medium uppercase tracking-wider transition-colors ${
            activeTab === "info"
              ? "text-white border-b border-white/40"
              : "text-white/30 hover:text-white/50"
          }`}
        >
          Info
        </button>
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex-1 h-10 text-xs font-medium uppercase tracking-wider transition-colors ${
            activeTab === "chat"
              ? "text-white border-b border-white/40"
              : "text-white/30 hover:text-white/50"
          }`}
        >
          Chat
        </button>
      </div>

      {/* Chat tab */}
      {activeTab === "chat" && (
        <div className="flex-1 overflow-hidden">
          <CommunityChat cluster={cluster} />
        </div>
      )}

      {/* Info tab */}
      {activeTab === "info" && (
      <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Title & Description */}
        <div>
          <h1 className="text-xl font-semibold text-white leading-tight mb-2">
            {cluster.title}
          </h1>
          {cluster.description && (
            <p className="text-sm text-white/40 leading-relaxed">
              {cluster.description}
            </p>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-white/30">
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm3-8.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
            </svg>
            <span>{cluster.fork_count} imports</span>
          </div>
          <span>{cluster.panel_count} entries</span>
          {cluster.category && (
            <span className="capitalize">{cluster.category}</span>
          )}
        </div>

        {/* Creator card */}
        <div className="p-4 rounded-lg border border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-3 mb-3">
            {cluster.author.avatar_url ? (
              <img
                src={cluster.author.avatar_url}
                alt=""
                className="w-10 h-10 rounded-full"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-neutral-700 flex items-center justify-center text-white/30 text-sm font-medium">
                {(cluster.author.display_name || "?")[0]?.toUpperCase()}
              </div>
            )}
            <div>
              <div className="text-sm font-medium text-white">
                {cluster.author.display_name || "Anonymous"}
              </div>
              {cluster.author.bio && (
                <div className="text-xs text-white/30 line-clamp-1">
                  {cluster.author.bio}
                </div>
              )}
            </div>
          </div>
          {/* Social links */}
          <div className="flex items-center gap-3 flex-wrap">
            {cluster.author.website_url && (
              <a
                href={cluster.author.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                Website
              </a>
            )}
            {cluster.author.twitter_handle && (
              <a
                href={`https://x.com/${cluster.author.twitter_handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                @{cluster.author.twitter_handle}
              </a>
            )}
            {cluster.author.github_username && (
              <a
                href={`https://github.com/${cluster.author.github_username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                GitHub
              </a>
            )}
          </div>
        </div>

        {/* Import button */}
        {!isOwner && (
          <button
            onClick={handleFork}
            disabled={forking || forked}
            className="w-full h-10 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {forked
              ? "Imported to Canvas!"
              : forking
                ? "Importing..."
                : "Import to My Canvas"}
          </button>
        )}

        {isOwner && (
          <Link
            href="/community/posts"
            className="w-full h-10 rounded-lg border border-white/[0.1] text-white/60 text-sm font-medium hover:text-white hover:border-white/[0.2] transition-colors flex items-center justify-center"
          >
            Manage Posts
          </Link>
        )}

        {/* Entries list */}
        <div>
          <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
            Entries ({cluster.entries.length})
          </h3>
          <div className="space-y-2">
            {cluster.entries.map((entry) => (
              <div
                key={entry.entry_id}
                className="p-3 rounded-md border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <div className="text-sm text-white/80 font-medium line-clamp-1 mb-0.5">
                  {entry.title || "Untitled"}
                </div>
                <div className="text-xs text-white/30 line-clamp-2">
                  {entry.summary || "No summary"}
                </div>
                {entry.source_platform && (
                  <span className="inline-block mt-1.5 text-[10px] font-mono uppercase tracking-wider text-white/20">
                    {entry.source_platform}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Brain summary */}
        {cluster.brain_instructions && (
          <div>
            <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
              Cluster Brain
            </h3>
            <div className="p-3 rounded-md border border-white/[0.05] bg-white/[0.02] text-xs text-white/40 leading-relaxed whitespace-pre-wrap line-clamp-[12]">
              {cluster.brain_instructions.slice(0, 500)}
              {cluster.brain_instructions.length > 500 && "..."}
            </div>
          </div>
        )}

        {/* Date */}
        <div className="text-xs text-white/20 pt-2 border-t border-white/[0.04]">
          Published {new Date(cluster.created_at).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
