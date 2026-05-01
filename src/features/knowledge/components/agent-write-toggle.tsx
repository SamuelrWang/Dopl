"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { toast } from "@/shared/ui/toast";
import { KnowledgeApiError, updateBase } from "../client/api";

interface Props {
  baseId: string;
  workspaceId: string;
  initialValue: boolean;
}

/**
 * Toggle for `agent_write_enabled`. When ON, MCP-origin callers can
 * create/edit/move/delete in this knowledge base. When OFF (the
 * default), agents can only read.
 *
 * The actual enforcement happens server-side in
 * [service.ts#assertAgentWriteAllowed](src/features/knowledge/server/service.ts).
 */
export function AgentWriteToggle({
  baseId,
  workspaceId,
  initialValue,
}: Props) {
  const [enabled, setEnabled] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);

  async function handleToggle(next: boolean) {
    setSubmitting(true);
    try {
      const updated = await updateBase(
        baseId,
        { agentWriteEnabled: next },
        workspaceId
      );
      setEnabled(updated.agentWriteEnabled);
      toast({
        title: updated.agentWriteEnabled
          ? "Agent writes enabled"
          : "Agent writes disabled",
        description: updated.agentWriteEnabled
          ? "Your agent (MCP / CLI) can now edit this knowledge base."
          : "Your agent can read but not modify this knowledge base.",
      });
    } catch (err) {
      const msg =
        err instanceof KnowledgeApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong";
      toast({ title: "Couldn't toggle", description: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/[0.08] p-4 bg-white/[0.02]">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary">
            Allow agent writes
          </p>
          <p className="mt-1 text-xs text-text-secondary leading-relaxed">
            Lets your connected agent (e.g. Claude Code via MCP) create,
            edit, move, and delete folders + entries in this knowledge
            base. Reads are always allowed regardless. Off by default
            for safety.
          </p>
          {enabled ? (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-300/80">
              <AlertTriangle size={11} />
              <span>
                Agent edits land directly. There&rsquo;s no review step.
              </span>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={submitting}
          onClick={() => handleToggle(!enabled)}
          className={cn(
            "shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors",
            enabled ? "bg-violet-500" : "bg-white/[0.12]",
            submitting && "opacity-50 cursor-not-allowed"
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-5" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
    </div>
  );
}
