"use client";

/**
 * Client body for the community cluster detail page. The server
 * component in `page.tsx` pre-fetches the cluster for both OG
 * metadata + first paint, then hands the snapshot to us — we avoid
 * the original "fetch on mount with spinner" flash.
 *
 * Responsibilities:
 *   - Resolve the current user (used for the "is owner" decision and
 *     to drive the auto-thumbnail-capture for owners).
 *   - Render the top bar with title, author, "Editing" badge, and a
 *     "Copy share link" icon button (visible to everyone — visitors
 *     re-share without opening devtools).
 *   - Mount `<SharedClusterShell>` — renders the full `/canvas`
 *     component tree in read-only mode (or owner-edit mode).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Link as LinkIcon } from "lucide-react";
import SharedClusterShell from "./shared-cluster-shell";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { captureAndUploadThumbnail } from "@/lib/community/capture-thumbnail";
import type { PublishedClusterDetail } from "@/lib/community/types";

interface Props {
  cluster: PublishedClusterDetail;
}

export default function CommunityDetailClient({
  cluster: initialCluster,
}: Props) {
  // Mutable-ish copy so thumbnail auto-capture can patch the in-memory
  // cluster (avoids a round trip to re-fetch just for the preview URL).
  const [cluster, setCluster] = useState<PublishedClusterDetail>(initialCluster);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const thumbnailCapturedRef = useRef(false);

  // Resolve the logged-in user (if any) for the "is owner" check.
  useEffect(() => {
    getSupabaseBrowser()
      .auth.getUser()
      .then(({ data }: { data: { user: { id: string } | null } }) => {
        setCurrentUserId(data.user?.id || null);
      })
      .catch(() => {});
  }, []);

  // Auto-capture a canvas thumbnail the first time the owner opens
  // their published cluster without one. Powers the OG image and
  // community gallery card.
  useEffect(() => {
    if (
      !currentUserId ||
      cluster.author.id !== currentUserId ||
      cluster.thumbnail_url ||
      thumbnailCapturedRef.current
    ) {
      return;
    }
    const timer = setTimeout(() => {
      const el = canvasContainerRef.current;
      if (!el) return;
      thumbnailCapturedRef.current = true;
      captureAndUploadThumbnail(el, cluster.slug).then((url) => {
        if (url) {
          setCluster((prev) => (prev ? { ...prev, thumbnail_url: url } : prev));
        }
      });
    }, 2000); // wait for canvas first paint
    return () => clearTimeout(timer);
  }, [cluster, currentUserId]);

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
