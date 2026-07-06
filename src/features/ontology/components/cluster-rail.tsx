"use client";

import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { GraphState } from "../graph-state";
import { TypeDot } from "./ontology-bits";

interface Props {
  graph: GraphState;
  selectedClusterId: string;
  selectedObjectId: string;
  onSelectCluster: (id: string) => void;
  onSelectObject: (id: string) => void;
  onCreateObject: (clusterId: string) => void;
  onCreateCluster: () => void;
}

/**
 * Left rail — clusters as folders, the selected cluster's objects as
 * rows beneath (study-notes sidebar: 13px rows, concave selection),
 * with create affordances for both levels.
 */
export function ClusterRail({
  graph,
  selectedClusterId,
  selectedObjectId,
  onSelectCluster,
  onSelectObject,
  onCreateObject,
  onCreateCluster,
}: Props) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-hidden rounded-[14px] border border-black/[0.08] bg-[#f1f2f4] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_18px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between px-4 py-3.5">
        <h1 className="text-sm font-semibold tracking-tight text-[#232a31]">
          Ontology
        </h1>
        <button
          type="button"
          onClick={onCreateCluster}
          className="btn-light rounded-md px-2.5 py-1 text-xs font-medium text-[#232a31]"
        >
          <span className="flex items-center gap-1">
            <Plus size={12} /> Cluster
          </span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {graph.clusters.map((cluster) => {
          const open = cluster.id === selectedClusterId;
          return (
            <div key={cluster.id} className="mb-1">
              <div className="group flex items-center gap-1 rounded-lg px-1.5 py-1.5 transition hover:bg-black/[0.035]">
                <button
                  type="button"
                  onClick={() => onSelectCluster(cluster.id)}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                >
                  <ChevronRight
                    size={13}
                    className={cn(
                      "shrink-0 text-[#98a2ad] transition-transform",
                      open && "rotate-90"
                    )}
                  />
                  <span className="flex-1 truncate text-[13px] font-semibold tracking-tight text-[#232a31]">
                    {cluster.name}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`New object in ${cluster.name}`}
                  title="New object"
                  onClick={() => onCreateObject(cluster.id)}
                  className="rounded-md p-1 text-[#98a2ad] opacity-0 transition hover:bg-black/[0.05] hover:text-[#232a31] group-hover:opacity-100"
                >
                  <Plus size={13} />
                </button>
                <span className="text-[11px] text-[#98a2ad]">
                  {cluster.objectIds.length}
                </span>
              </div>
              {open && (
                <div className="mt-0.5 flex flex-col">
                  {cluster.objectIds.map((id) => {
                    const obj = graph.objects[id];
                    if (!obj) return null;
                    const active = id === selectedObjectId;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onSelectObject(id)}
                        className={cn(
                          "relative ml-4 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
                          active
                            ? "bg-[#e9e9e7] font-medium text-[#232a31] shadow-[inset_0_1px_2px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(0,0,0,0.06),inset_0_-1px_0_rgba(255,255,255,0.7),0_0_0_1px_rgba(0,0,0,0.05)]"
                            : "text-[#646d78] hover:bg-black/[0.035] hover:text-[#232a31]"
                        )}
                      >
                        <TypeDot type={obj.type} />
                        <span className="truncate">{obj.name}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => onCreateObject(cluster.id)}
                    className="ml-4 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-[#98a2ad] transition hover:bg-black/[0.035] hover:text-[#232a31]"
                  >
                    <Plus size={12} /> New object
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
