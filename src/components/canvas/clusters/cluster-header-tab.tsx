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
import { useCanvas } from "../canvas-store";
import type { Cluster } from "../types";
import { isPanelDeletable } from "../types";
import { PublishDialog } from "@/components/community/publish-dialog";

interface ClusterHeaderTabProps {
  cluster: Cluster;
  /** World-space x at the cluster's bottom-center. */
  worldX: number;
  /** World-space y at the cluster's bottom edge. */
  worldY: number;
  /** Current camera zoom — used for inverse scale. */
  zoom: number;
}

export function ClusterHeaderTab({
  cluster,
  worldX,
  worldY,
  zoom,
}: ClusterHeaderTabProps) {
  const { state, dispatch } = useCanvas();
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
          .catch(() => {});
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
      }).catch(() => {});
    }
    dispatch({ type: "DELETE_CLUSTER", clusterId: cluster.id });
  }

  function handleDeleteMembers() {
    setMenuOpen(false);
    const deletable = state.panels.filter(
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
        transform: `translateX(-50%) scale(var(--canvas-inv-zoom, ${1 / zoom}))`,
        transformOrigin: "center top",
        pointerEvents: "auto",
      }}
      className="z-20"
    >
      <div className="inline-flex items-center h-6 px-2 gap-1.5 rounded-[4px] bg-black/[0.55] backdrop-blur-md border border-white/[0.12] shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
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
            className="bg-transparent outline-none font-mono text-[10px] uppercase tracking-wider text-white/90 w-28"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-mono text-[10px] uppercase tracking-wider text-white/80 hover:text-white transition-colors"
            title="Click to rename"
          >
            {cluster.name}
          </button>
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
          className="absolute left-1/2 -translate-x-1/2 mt-1 min-w-[120px] bg-black/[0.7] backdrop-blur-md border border-white/[0.12] rounded-[4px] shadow-[0_4px_16px_rgba(0,0,0,0.4)] overflow-hidden"
          role="menu"
        >
          {cluster.dbId && (
            <button
              type="button"
              onClick={handlePublishClick}
              role="menuitem"
              className="w-full text-left px-3 h-8 font-mono text-[10px] uppercase tracking-wider text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              Publish
            </button>
          )}
          <button
            type="button"
            onClick={handleUncluster}
            role="menuitem"
            className="w-full text-left px-3 h-8 font-mono text-[10px] uppercase tracking-wider text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            Uncluster
          </button>
          <button
            type="button"
            onClick={handleDeleteMembers}
            role="menuitem"
            className="w-full text-left px-3 h-8 font-mono text-[10px] uppercase tracking-wider text-red-400/80 hover:text-red-400 hover:bg-white/[0.06] transition-colors"
          >
            Delete All
          </button>
        </div>
      )}

      {cluster.dbId && (
        <PublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          clusterName={cluster.name}
          clusterDbId={cluster.dbId}
          onPublished={(slug) => {
            // Could navigate to the published page or show a toast
            window.open(`/community/${slug}`, "_blank");
          }}
        />
      )}
    </div>
  );
}
