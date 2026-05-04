"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface AgentRowProps {
  /** Verb-y label: "Searched workspace knowledge", "Read entry", "Loaded skill". */
  kind: string;
  /** What the action targeted: query, entry title, skill name, etc. */
  target: string;
  /** Optional metadata appended after a "·": result count, KB name, etc. */
  meta?: string;
  /** When true, the row renders pulsing while the action is in progress. */
  pending?: boolean;
  /** Open state for expandable rows; ignored when no children are passed. */
  expanded?: boolean;
  children?: React.ReactNode;
}

/**
 * One step inside a `<DoplAgentGroup>`. Tri-text layout:
 *   [kind muted] [target bright] · [meta dimmer]      [chevron if expandable]
 *
 * Click on the row to toggle the expansion (only when there's content
 * to reveal). Pending rows pulse subtly so the user can tell which step
 * is still executing during a multi-tool turn.
 */
export function AgentRow({
  kind,
  target,
  meta,
  pending = false,
  expanded,
  children,
}: AgentRowProps) {
  const hasContent = Boolean(children);
  const [open, setOpen] = useState(Boolean(expanded));

  return (
    <div className={"py-1 " + (pending ? "animate-pulse" : "")}>
      <button
        type="button"
        onClick={() => hasContent && setOpen((v) => !v)}
        className={
          "w-full flex items-center gap-2 text-left " +
          (hasContent ? "cursor-pointer" : "cursor-default")
        }
      >
        <span className="text-[12.5px] text-text-secondary/55 shrink-0">
          {kind}
        </span>
        <span className="text-[12.5px] text-text-secondary/85 font-medium truncate">
          {target}
        </span>
        {meta && (
          <span className="text-[11px] text-text-secondary/40 truncate">
            · {meta}
          </span>
        )}
        {hasContent && (
          <span className="ml-auto shrink-0 text-text-secondary/50">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        )}
      </button>
      {open && hasContent && <div className="mt-2 mb-1 ml-0">{children}</div>}
    </div>
  );
}
