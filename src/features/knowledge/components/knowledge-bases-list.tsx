"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import type { KnowledgeBase } from "../types";
import { CreateBaseDialog } from "./create-base-dialog";

interface Props {
  workspaceSlug: string;
  workspaceId: string;
  bases: KnowledgeBase[];
}

/**
 * Index page for `/[workspaceSlug]/knowledge` — grid of every
 * knowledge base in the workspace plus a "+ New" tile + dialog.
 */
export function KnowledgeBasesList({
  workspaceSlug,
  workspaceId,
  bases,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <PageTopBar
        title="Knowledge"
        trailing={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors cursor-pointer"
          >
            <Plus size={12} />
            New knowledge base
          </button>
        }
      />
      <div className="container mx-auto max-w-6xl px-6 pt-[68px] pb-8 pointer-events-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bases.map((kb) => (
            <Link
              key={kb.id}
              href={`/${workspaceSlug}/knowledge/${kb.slug}`}
              className="group block rounded-xl border border-white/[0.06] p-5 hover:border-white/[0.15] hover:bg-white/[0.02] transition-colors cursor-pointer"
              style={{ backgroundColor: "oklch(0.13 0 0)" }}
            >
              <p className="text-sm font-semibold text-text-primary truncate">
                {kb.name}
              </p>
              {kb.description ? (
                <p className="mt-1 text-xs text-text-secondary line-clamp-2">
                  {kb.description}
                </p>
              ) : null}
              <div className="mt-4 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
                <span>{kb.agentWriteEnabled ? "Agent: on" : "Agent: off"}</span>
                <span>Updated {formatRelative(kb.updatedAt)}</span>
              </div>
            </Link>
          ))}

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="group flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] p-5 hover:border-white/[0.2] hover:bg-white/[0.02] transition-colors cursor-pointer min-h-[148px]"
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-white/[0.06] mb-2 group-hover:border-white/[0.15] transition-colors">
              <Plus size={16} className="text-text-secondary" />
            </div>
            <p className="text-sm font-medium text-text-secondary">
              New knowledge base
            </p>
          </button>
        </div>
      </div>

      <CreateBaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
      />
    </>
  );
}

/** Cheap relative-time formatter. Good enough for "Updated 2h ago". */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}
