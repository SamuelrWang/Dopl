"use client";

/**
 * Client body for the community cluster detail page. The server
 * component in `page.tsx` pre-fetches the cluster for both OG
 * metadata + first paint, then hands the snapshot to us — we avoid
 * the original "fetch on mount with spinner" flash.
 *
 * Responsibilities:
 *   - Resolve the current user (used for the "is owner" decision).
 *   - Render the top bar with title, author, "Editing" badge, and a
 *     "Copy share link" icon button (visible to everyone — visitors
 *     re-share without opening devtools).
 *   - Mount `<SharedClusterShell>` — renders the full `/canvas`
 *     component tree in read-only mode (or owner-edit mode).
 *
 * Thumbnails for OG / gallery are now served by the dynamic
 * opengraph-image route, so the html2canvas auto-capture that used to
 * run here on owner-first-visit has been removed.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Link as LinkIcon } from "lucide-react";
import SharedClusterShell from "./shared-cluster-shell";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import type { PublishedClusterDetail } from "@/lib/community/types";

interface Props {
  cluster: PublishedClusterDetail;
}

export default function CommunityDetailClient({ cluster }: Props) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Resolve the logged-in user (if any) for the "is owner" check.
  useEffect(() => {
    getSupabaseBrowser()
      .auth.getUser()
      .then(({ data }: { data: { user: { id: string } | null } }) => {
        setCurrentUserId(data.user?.id || null);
      })
      .catch(() => {});
  }, []);

  async function handleCopyLink() {
    const shareUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Ignore — the icon state flip still confirms intent.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isOwner = currentUserId === cluster.author.id;

  return (
    <div className="fixed inset-0 bg-[#0c0c0c] flex flex-col">
      {/* Top bar */}
      <div className="h-12 flex-shrink-0 border-b border-white/[0.06] bg-[#0a0a0a] flex items-center px-4 gap-4 z-10">
        <Link
          href="/community"
          className="text-white/30 hover:text-white/60 transition-colors"
        >
          <ArrowLeft size={16} />
        </Link>
        <span className="text-sm text-white/60 font-medium truncate">
          {cluster.title}
        </span>
        <button
          type="button"
          onClick={handleCopyLink}
          aria-label={copied ? "Copied" : "Copy share link"}
          title={copied ? "Copied" : "Copy share link"}
          className="text-white/30 hover:text-white/80 transition-colors"
        >
          {copied ? <Check size={14} /> : <LinkIcon size={14} />}
        </button>
        {isOwner && (
          <span className="ml-1 text-[10px] uppercase tracking-wider text-amber-400/60 bg-amber-400/[0.08] border border-amber-400/[0.15] px-1.5 py-0.5 rounded">
            Editing
          </span>
        )}
        <div className="flex-1" />
        <span className="text-xs text-white/20">
          by {cluster.author.display_name || "Anonymous"}
        </span>
      </div>

      {/* Main content — SharedClusterShell renders the full /canvas
          stack (Canvas + CanvasPanel + EntryPanelBody) with read-only
          capabilities for visitors and drag-persist for the owner. */}
      <SharedClusterShell
        cluster={cluster}
        isOwner={isOwner}
        canvasContainerRef={canvasContainerRef}
      />
    </div>
  );
}
