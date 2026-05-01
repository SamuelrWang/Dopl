"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { HARDCODED_KBS } from "../data";

interface Props {
  workspaceSlug: string;
}

/**
 * Index page for `/[workspaceSlug]/knowledge` — grid of every
 * knowledge base in the workspace plus a "new KB" tile. Hardcoded for
 * now; the sidebar dropdown navigates straight to a specific KB so
 * this page is the catch-all when you click the parent "Knowledge"
 * label or the "New knowledge base" link.
 */
export function KnowledgeBasesList({ workspaceSlug }: Props) {
  return (
    <>
      <PageTopBar
        title="Knowledge"
        trailing={
          <button
            type="button"
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors cursor-pointer"
          >
            <Plus size={12} />
            New knowledge base
          </button>
        }
      />
      <div className="container mx-auto max-w-6xl px-6 pt-[68px] pb-8 pointer-events-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {HARDCODED_KBS.map((kb) => (
          <Link
            key={kb.slug}
            href={`/${workspaceSlug}/knowledge/${kb.slug}`}
            className="group block rounded-xl border border-white/[0.06] p-5 hover:border-white/[0.15] hover:bg-white/[0.02] transition-colors cursor-pointer"
            style={{ backgroundColor: "oklch(0.13 0 0)" }}
          >
            <p className="text-sm font-semibold text-text-primary truncate">
              {kb.name}
            </p>
            <p className="mt-1 text-xs text-text-secondary line-clamp-2">
              {kb.description}
            </p>
            <div className="mt-4 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
              <span>{kb.entries.length} entries</span>
              <span>
                {kb.sources.filter((s) => s.status === "connected").length}{" "}
                sources
              </span>
              <span>{kb.updatedAt}</span>
            </div>
          </Link>
        ))}

        <button
          type="button"
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
    </>
  );
}
