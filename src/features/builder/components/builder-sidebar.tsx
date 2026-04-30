"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { useCanvas, useCanvasScope } from "@/features/canvas/canvas-store";
import type { Cluster } from "@/features/canvas/types";
import {
  DEFAULT_PANEL_SIZE,
  computePanelsBounds,
} from "@/features/canvas/types";

interface BuilderSidebarProps {
  activeClusterId: string | null;
  onSelectCluster: (id: string) => void;
  compact?: boolean;
}

export function BuilderSidebar({
  activeClusterId,
  onSelectCluster,
  compact,
}: BuilderSidebarProps) {
  const { state, dispatch } = useCanvas();
  const scope = useCanvasScope();
  const canvasId = scope?.canvasId ?? null;
  const { panels, clusters } = state;

  const handleCreateCluster = useCallback(() => {
    const chatPanelId = `panel-${state.nextPanelId}`;
    const clusterId = `cluster-${state.nextClusterId}`;
    const brainPanelId = `panel-${state.nextPanelId + 1}`;

    const bounds = computePanelsBounds(state.panels);
    const chatPos = bounds
      ? { x: bounds.minX, y: bounds.maxY + 60 }
      : { x: 100, y: 100 };

    dispatch({
      type: "CREATE_CHAT_PANEL",
      id: chatPanelId,
      x: chatPos.x,
      y: chatPos.y,
      title: "New Chat",
    });

    const cluster: Cluster = {
      id: clusterId,
      name: "New Cluster",
      panelIds: [chatPanelId],
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "CREATE_CLUSTER", cluster, moves: [] });

    dispatch({
      type: "CREATE_CLUSTER_BRAIN_PANEL",
      id: brainPanelId,
      clusterId,
      clusterName: "New Cluster",
      x: chatPos.x + DEFAULT_PANEL_SIZE.width + 32,
      y: chatPos.y,
      initialStatus: "ready",
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (canvasId) headers["X-Canvas-Id"] = canvasId;
    fetch("/api/clusters", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "New Cluster", entry_ids: [] }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.id && data.slug) {
          dispatch({
            type: "UPDATE_CLUSTER_DB_INFO",
            clusterId,
            dbId: data.id,
            slug: data.slug,
          });
        }
      })
      .catch(() => {});

    onSelectCluster(clusterId);
  }, [state, dispatch, onSelectCluster, canvasId]);

  if (compact) {
    return (
      <button
        onClick={handleCreateCluster}
        className="group relative inline-flex items-center gap-2 h-10 px-5 rounded-full bg-white/[0.06] border border-white/[0.14] text-xs font-medium text-white/80 hover:bg-white/[0.10] hover:border-white/[0.22] hover:text-white transition-all duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="text-white/60 group-hover:text-white/90 transition-colors"
        >
          <path d="M6 2v8M2 6h8" />
        </svg>
        New Cluster
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 h-10 flex items-center justify-between px-4" style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}>
        <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">
          Clusters
        </span>
        <button
          onClick={handleCreateCluster}
          className="w-6 h-6 flex items-center justify-center rounded-[3px] bg-transparent hover:bg-white/[0.08] text-white/40 hover:text-white/80 transition-colors"
          title="New cluster"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M6 2v8M2 6h8" />
          </svg>
        </button>
      </div>

      {/* Cluster list */}
      <div className="flex-1 overflow-y-auto py-1">
        {clusters.map((cluster) => {
          const entryCount = cluster.panelIds.filter((pid) => {
            const p = panels.find((pp) => pp.id === pid);
            return p?.type === "entry";
          }).length;
          const chatCount = cluster.panelIds.filter((pid) => {
            const p = panels.find((pp) => pp.id === pid);
            return p?.type === "chat";
          }).length;

          return (
            <ClusterItem
              key={cluster.id}
              cluster={cluster}
              isActive={cluster.id === activeClusterId}
              entryCount={entryCount}
              chatCount={chatCount}
              onSelect={() => onSelectCluster(cluster.id)}
              dispatch={dispatch}
            />
          );
        })}
      </div>
    </div>
  );
}

function ClusterItem({
  cluster,
  isActive,
  entryCount,
  chatCount,
  onSelect,
  dispatch,
}: {
  cluster: Cluster;
  isActive: boolean;
  entryCount: number;
  chatCount: number;
  onSelect: () => void;
  dispatch: React.Dispatch<import("@/features/canvas/types").CanvasAction>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(cluster.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const commitName = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== cluster.name) {
      dispatch({
        type: "UPDATE_CLUSTER_NAME",
        clusterId: cluster.id,
        name: trimmed,
      });
    } else {
      setEditName(cluster.name);
    }
    setIsEditing(false);
  };

  const stats: string[] = [];
  if (entryCount > 0) stats.push(`${entryCount} ${entryCount === 1 ? "entry" : "entries"}`);
  if (chatCount > 0) stats.push(`${chatCount} ${chatCount === 1 ? "chat" : "chats"}`);

  return (
    <button
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
        setEditName(cluster.name);
      }}
      className={`w-full text-left px-4 py-2 transition-colors duration-100 ${
        isActive
          ? "bg-white/[0.06]"
          : "hover:bg-white/[0.03]"
      }`}
      style={isActive ? { boxShadow: "inset 2px 0 0 var(--accent-primary)" } : undefined}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") {
              setEditName(cluster.name);
              setIsEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full bg-transparent text-[12px] text-white/90 outline-none border-b border-white/[0.2] pb-0.5"
        />
      ) : (
        <div className="text-[12px] font-medium text-white/80 truncate">
          {cluster.name}
        </div>
      )}
      {stats.length > 0 && (
        <div className="font-mono text-[9px] text-white/30 mt-0.5">
          {stats.join(" \u00B7 ")}
        </div>
      )}
    </button>
  );
}
