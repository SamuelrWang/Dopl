"use client";

import { useState } from "react";
import { BookOpen, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ProfileKnowledgeBase } from "../types";
import { MockSwitch, SectionPanel } from "./config-bits";

/**
 * Manager knowledge-access section — tinted KB cards with entry counts,
 * freshness, visibility, and an access switch. Local state only.
 */
export function KnowledgeSection({
  knowledgeBases: initial,
}: {
  knowledgeBases: ProfileKnowledgeBase[];
}) {
  const [kbs, setKbs] = useState(initial);
  const onCount = kbs.filter((kb) => kb.enabled).length;

  return (
    <SectionPanel
      label="Knowledge access"
      meta={`${onCount} of ${kbs.length} granted`}
      action={
        <button
          type="button"
          className="btn-light flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-text-primary"
        >
          <Plus size={12} /> Grant access
        </button>
      }
      flush
    >
      <div className="grid grid-cols-1 gap-3 border-t border-black/[0.06] p-3.5 md:grid-cols-2">
        {kbs.map((kb, i) => (
          <div
            key={kb.id}
            className={cn(
              "flex items-start gap-3 rounded-xl border border-black/[0.1] p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-opacity",
              !kb.enabled && "opacity-60"
            )}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.15)]"
              style={{ background: kb.tint }}
            >
              <BookOpen size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold leading-tight text-text-primary">
                {kb.name}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                {kb.summary}
              </p>
              <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-text-muted">
                <span>{kb.entryCount} entries</span>
                <span aria-hidden>·</span>
                <span>Updated {kb.updatedAt}</span>
                <span aria-hidden>·</span>
                <span className="rounded-full bg-bg-inset px-1.5 py-px font-medium text-text-secondary">
                  {kb.visibility}
                </span>
              </div>
            </div>
            <MockSwitch
              on={kb.enabled}
              label={`Toggle ${kb.name}`}
              onToggle={() =>
                setKbs((prev) =>
                  prev.map((p, j) => (j === i ? { ...p, enabled: !p.enabled } : p))
                )
              }
            />
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}
