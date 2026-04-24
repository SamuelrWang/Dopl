"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PublishedClusterSummary } from "@/features/community/server/types";

type PostStatus = "published" | "draft" | "archived";

export default function MyPostsPage() {
  const [posts, setPosts] = useState<PublishedClusterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPosts();
  }, []);

  async function fetchPosts() {
    try {
      const res = await fetch("/api/community/posts");
      if (!res.ok) {
        if (res.status === 401) {
          setError("Please sign in to view your posts.");
          return;
        }
        throw new Error("Failed to load posts");
      }
      const data = await res.json();
      setPosts(data.posts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(slug: string, status: PostStatus) {
    try {
      const res = await fetch(`/api/community/${slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update");
      // Refresh the list
      fetchPosts();
    } catch {
      // Could show a toast
    }
  }

  async function handleDelete(slug: string) {
    if (!confirm("Archive this post? It will no longer be visible to the community.")) return;
    await handleStatusChange(slug, "archived");
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-white/[0.06] rounded" />
          <div className="h-24 bg-white/[0.06] rounded" />
          <div className="h-24 bg-white/[0.06] rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <p className="text-white/50">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">My Posts</h1>
          <p className="text-sm text-white/40 mt-1">
            Manage your published clusters
          </p>
        </div>
        <Link
          href="/community"
          className="text-sm text-white/50 hover:text-white transition-colors"
        >
          View Community
        </Link>
      </div>

      {posts.length === 0 ? (
        <div className="text-center py-16 border border-white/[0.08] rounded-lg">
          <p className="text-white/40 mb-2">No published clusters yet</p>
          <p className="text-sm text-white/25">
            Go to your canvas, open a cluster&apos;s menu, and click &quot;Publish&quot; to share it.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div
              key={post.id}
              className="flex items-center gap-4 p-4 border border-white/[0.08] rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
            >
              {/* Thumbnail */}
              <div className="w-20 h-14 rounded bg-white/[0.06] flex-shrink-0 overflow-hidden">
                {post.thumbnail_url ? (
                  <img
                    src={post.thumbnail_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/20 text-xs">
                    No preview
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/community/${post.slug}`}
                    className="text-sm font-medium text-white hover:text-white/80 truncate"
                  >
                    {post.title}
                  </Link>
                  <StatusBadge status={post.status} />
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-white/30">
                  <span>{post.panel_count} entries</span>
                  <span>{post.fork_count} imports</span>
                  {post.category && <span>{post.category}</span>}
                  <span>
                    {new Date(post.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Link
                  href={`/community/${post.slug}`}
                  className="h-7 px-3 rounded text-xs text-white/60 hover:text-white border border-white/[0.1] hover:border-white/[0.2] transition-colors inline-flex items-center"
                >
                  View
                </Link>
                {post.status === "published" ? (
                  <button
                    onClick={() => handleDelete(post.slug)}
                    className="h-7 px-3 rounded text-xs text-red-400/60 hover:text-red-400 border border-white/[0.1] hover:border-red-400/[0.3] transition-colors"
                  >
                    Archive
                  </button>
                ) : post.status === "archived" ? (
                  <button
                    onClick={() => handleStatusChange(post.slug, "published")}
                    className="h-7 px-3 rounded text-xs text-green-400/60 hover:text-green-400 border border-white/[0.1] hover:border-green-400/[0.3] transition-colors"
                  >
                    Republish
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PostStatus }) {
  const styles: Record<PostStatus, string> = {
    published: "text-green-400/80 bg-green-400/[0.08] border-green-400/[0.15]",
    draft: "text-yellow-400/80 bg-yellow-400/[0.08] border-yellow-400/[0.15]",
    archived: "text-white/30 bg-white/[0.04] border-white/[0.08]",
  };

  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${styles[status]}`}
    >
      {status}
    </span>
  );
}
