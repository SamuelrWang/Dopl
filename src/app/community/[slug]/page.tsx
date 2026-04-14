"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PublishedCanvas } from "@/components/community/published-canvas";
import { DetailPanel } from "@/components/community/detail-panel";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { captureAndUploadThumbnail } from "@/lib/community/capture-thumbnail";
import type { PublishedClusterDetail } from "@/lib/community/types";

export default function CommunityDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [cluster, setCluster] = useState<PublishedClusterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const thumbnailCapturedRef = useRef(false);

  // Auto-capture thumbnail when owner visits a post with no thumbnail
  useEffect(() => {
    if (
      !cluster ||
      !currentUserId ||
      cluster.author.id !== currentUserId ||
      cluster.thumbnail_url ||
      thumbnailCapturedRef.current
    ) return;

    // Wait for canvas to render
    const timer = setTimeout(() => {
      const el = canvasContainerRef.current;
      if (!el) return;
      thumbnailCapturedRef.current = true;
      captureAndUploadThumbnail(el, cluster.slug).then((url) => {
        if (url) {
          setCluster((prev) => prev ? { ...prev, thumbnail_url: url } : prev);
        }
      });
    }, 2000); // Give canvas 2s to render

    return () => clearTimeout(timer);
  }, [cluster, currentUserId]);

  // Get current user ID (if logged in)
  useEffect(() => {
    getSupabaseBrowser()
      .auth.getUser()
      .then(({ data }: { data: { user: { id: string } | null } }) => {
        setCurrentUserId(data.user?.id || null);
      })
      .catch(() => {});
  }, []);

  // Fetch published cluster
  useEffect(() => {
    async function fetchCluster() {
      try {
        const res = await fetch(`/api/community/${encodeURIComponent(slug)}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("This cluster doesn't exist or has been archived.");
          } else {
            throw new Error("Failed to load");
          }
          return;
        }
        const data = await res.json();
        setCluster(data);
      } catch {
        setError("Failed to load this cluster.");
      } finally {
        setLoading(false);
      }
    }
    fetchCluster();
  }, [slug]);

  // Handle panel position updates (creator only)
  const handlePanelsMove = useCallback(
    (moves: Array<{ id: string; x: number; y: number }>) => {
      if (!cluster) return;
      fetch(`/api/community/${encodeURIComponent(cluster.slug)}/panels`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ panels: moves }),
      }).catch(() => {});
    },
    [cluster]
  );

  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#0c0c0c] flex items-center justify-center">
        <div className="text-white/30 text-sm">Loading...</div>
      </div>
    );
  }

  if (error || !cluster) {
    return (
      <div className="fixed inset-0 bg-[#0c0c0c] flex flex-col items-center justify-center gap-4">
        <p className="text-white/40">{error || "Not found"}</p>
        <Link
          href="/community"
          className="text-sm text-white/30 hover:text-white/60 inline-flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft size={14} /> Back to Community
        </Link>
      </div>
    );
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
        {isOwner && (
          <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-400/60 bg-amber-400/[0.08] border border-amber-400/[0.15] px-1.5 py-0.5 rounded">
            Editing
          </span>
        )}
        <div className="flex-1" />
        <span className="text-xs text-white/20">
          by {cluster.author.display_name || "Anonymous"}
        </span>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 relative" ref={canvasContainerRef}>
          <PublishedCanvas
            panels={cluster.panels}
            readOnly={!isOwner}
            onPanelsMove={isOwner ? handlePanelsMove : undefined}
          />
        </div>

        {/* Detail panel */}
        <DetailPanel cluster={cluster} isOwner={isOwner} />
      </div>
    </div>
  );
}
