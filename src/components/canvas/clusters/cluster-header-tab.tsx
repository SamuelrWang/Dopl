"use client";

/**
 * ClusterHeaderTab — small dark-glass pill positioned at the bottom-center
 * of a cluster outline in WORLD SPACE. An inverse `scale(1/zoom)` keeps
 * the text readable at any zoom while the position stays locked to the
 * cluster.
 *
 * Shows:
 *   - The cluster name (click to inline-edit)
 *   - An ellipsis button that opens a popover menu with:
 *       • Uncluster — dissolves the cluster
 *       • Delete — closes every panel in the cluster
 *
 * Edit UX:
 *   - Single click on the name → inline input
 *   - Enter/blur → commit, Escape → cancel
 */

import { useEffect, useRef, useState } from "react";
import { useCapabilities, usePanelsContext } from "../canvas-store";
import type { Cluster } from "../types";
import { isPanelDeletable } from "../types";
import { PublishDialog } from "@/components/community/publish-dialog";
import { toast } from "@/components/ui/toast";

interface ClusterHeaderTabProps {
  cluster: Cluster;
  /** World-space x at the cluster's bottom-center. */
  worldX: number;
  /** World-space y at the cluster's bottom edge. */
  worldY: number;
}

export function ClusterHeaderTab({
  cluster,
  worldX,
  worldY,
}: ClusterHeaderTabProps) {
  const { panels, dispatch } = usePanelsContext();
  // On the main /canvas both flags are true (default capabilities);
  // on the shared-cluster viewer they're narrowed so visitors can't
  // Uncluster / Delete / Publish a cluster they don't own. Read
  // share is always allowed.
  const capabilities = useCapabilities();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cluster.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const tabRef = useRef<HTMLDivElement>(null);

  // Reset draft when the authoritative name changes (e.g. AI name arrived).
  useEffect(() => {
    if (!editing) setDraft(cluster.name);
  }, [cluster.name, editing]);

  // Close the ellipsis menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onGlobalPointerDown(e: PointerEvent) {
      if (tabRef.current && !tabRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onGlobalPointerDown);
    return () =>
      document.removeEventListener("pointerdown", onGlobalPointerDown);
  }, [menuOpen]);

  function commitName() {
    const next = draft.trim();
    if (next && next !== cluster.name) {
      dispatch({
        type: "UPDATE_CLUSTER_NAME",
        clusterId: cluster.id,
        name: next,
      });
      if (cluster.slug) {
        fetch(`/api/clusters/${encodeURIComponent(cluster.slug)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: next }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.slug && data.slug !== cluster.slug) {
              dispatch({
                type: "UPDATE_CLUSTER_DB_INFO",
                clusterId: cluster.id,
                dbId: data.id,
                slug: data.slug,
              });
            }
          })
          .catch((err) => console.error("[cluster-header] sync failed:", err));
      }
    } else {
      setDraft(cluster.name);
    }
    setEditing(false);
  }

  function cancelEdit() {
    setDraft(cluster.name);
    setEditing(false);
  }

  function handleUncluster() {
    setMenuOpen(false);
    if (cluster.slug) {
      fetch(`/api/clusters/${encodeURIComponent(cluster.slug)}`, {
        method: "DELETE",
      }).catch((err) => console.error("[cluster-header] sync failed:", err));
    }
    dispatch({ type: "DELETE_CLUSTER", clusterId: cluster.id });
  }

  function handleDeleteMembers() {
    setMenuOpen(false);
    const deletable = panels.filter(
      (p) => cluster.panelIds.includes(p.id) && isPanelDeletable(p)
    );
    for (const p of deletable) {
      dispatch({ type: "CLOSE_PANEL", id: p.id });
    }
  }

  function handlePublishClick() {
    setMenuOpen(false);
    setPublishOpen(true);
  }

  /**
   * Grab the already-published URL for this cluster and drop it on the
   * clipboard. Visible only when `cluster.publishedSlug` is set — i.e.
   * the cluster already has a live community page. Used for the
   * X-comment workflow where the user wants to re-paste the link days
   * or weeks after the initial publish.
   */
  async function handleCopyShareLink() {
    setMenuOpen(false);
    if (!cluster.publishedSlug) return;
    const shareUrl = `${window.location.origin}/community/${cluster.publishedSlug}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Clipboard API unavailable — toast's "Open" action still gets
      // the user to the page.
    }
    toast({
      title: "Share link copied",
      description: shareUrl,
      action: {
        label: "Open",
        onClick: () => window.open(shareUrl, "_blank"),
      },
    });
  }

  return (
    <div
      ref={tabRef}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: worldX,
        top: worldY,
        // Inverse-scale using --canvas-inv-zoom (set on the world div).
        // Updated in real-time during gestures via applyCameraDirect,
        // so there's zero lag — no waiting for the React state flush.
        transform: `translateX(-50%) scale(var(--canvas-inv-zoom, 1))`,
        transformOrigin: "center top",
        pointerEvents: "auto",
      }}
      className="z-20"
    >
      <div className="inline-flex items-center h-6 px-2 gap-1.5 rounded-[4px] bg-[var(--cluster-tab-surface)] border border-white/[0.12] shadow-[0_2px_8px_rgba(0,0,0,0.35)] whitespace-nowrap">
        {editing ? (
          <input
            ref={(el) => el?.focus({ preventScroll: true })}
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/\s/g, "_"))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitName();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
            onBlur={commitName}
            // `size` auto-fits the input to the draft length so long
            // cluster names (e.g. POLYMARKET_TRADING_BOTS) don't truncate
            // or force wrap. Clamp at a reasonable min so an empty input
            // still has a click target.
            size={Math.max(draft.length, 10)}
            className="bg-transparent outline-none font-mono text-[10px] uppercase tracking-wider text-white/90"
          />
        ) : capabilities.canAdd ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-mono text-[10px] uppercase tracking-wider text-white/80 hover:text-white transition-colors whitespace-nowrap"
            title="Click to rename"
          >
            {cluster.name}
          </button>
        ) : (
          // Read-only viewer — name is plain text, not an edit target.
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/80 whitespace-nowrap">
            {cluster.name}
          </span>
        )}

        <span className="w-px h-3 bg-white/[0.12]" aria-hidden />

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Cluster menu"
          className="w-5 h-5 flex items-center justify-center text-white/50 hover:text-white/90 transition-colors"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="currentColor"
            aria-hidden
          >
            <circle cx="2" cy="6" r="1" />
            <circle cx="6" cy="6" r="1" />
            <circle cx="10" cy="6" r="1" />
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div
          className="absolute left-1/2 -translate-x-1/2 mt-1 min-w-[120px] bg-[var(--cluster-menu-surface)] border border-white/[0.12] rounded-[4px] shadow-[0_4px_16px_rgba(0,0,0,0.4)] overflow-hidden"
          role="menu"
        >
          {capabilities.canAdd && cluster.dbId && !cluster.publishedSlug && (
            <button
              type="button"
              onClick={handlePublishClick}
              role="menuitem"
              className="w-full text-left px-3 h-8 font-mono text-[10px] uppercase tracking-wider text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              Publish
            </button>
          )}
          {cluster.publishedSlug && (
            <button
              type="button"
              onClick={handleCopyShareLink}
              role="menuitem"
              className="w-full text-left px-3 h-8 font-mono text-[10px] uppercase tracking-wider text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              Copy share link
            </button>
          )}
          {capabilities.canDelete && (
            <button
              type="button"
              onClick={handleUncluster}
              role="menuitem"
              className="w-full text-left px-3 h-8 font-mono text-[10px] uppercase tracking-wider text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              Uncluster
            </button>
          )}
          {capabilities.canDelete && (
            <button
              type="button"
              onClick={handleDeleteMembers}
              role="menuitem"
              className="w-full text-left px-3 h-8 font-mono text-[10px] uppercase tracking-wider text-red-400/80 hover:text-red-400 hover:bg-white/[0.06] transition-colors"
            >
              Delete All
            </button>
          )}
        </div>
      )}

      {cluster.dbId && (
        <PublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          clusterName={cluster.name}
          clusterDbId={cluster.dbId}
          onPublished={(slug) => {
            // Stamp the slug locally so the "Copy share link" menu
            // item appears immediately without waiting for a reload.
            dispatch({
              type: "UPDATE_CLUSTER_PUBLISHED_SLUG",
              clusterId: cluster.id,
              publishedSlug: slug,
            });
            // PublishDialog already wrote the URL to the clipboard;
            // surface that to the user + offer one-click to view.
            const shareUrl = `${window.location.origin}/community/${slug}`;
            toast({
              title: "Share link copied",
              description: shareUrl,
              action: {
                label: "Open",
                onClick: () => window.open(shareUrl, "_blank"),
              },
            });
          }}
        />
      )}
    </div>
  );
}
