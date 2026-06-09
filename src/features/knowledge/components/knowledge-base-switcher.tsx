"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock, Plus, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { toast } from "@/shared/ui/toast";
import { useMyAccessContext } from "@/features/members/hooks/use-my-access";
import { meetsLevel } from "@/features/members/access-defaults";
import { useKnowledgeBases } from "../client/hooks";
import { useKnowledgeRealtime } from "../client/realtime";
import {
  createBase as apiCreateBase,
  createEntry as apiCreateEntry,
} from "../client/api";
import type { KnowledgeBase } from "../types";

const DEFAULT_KB_README_BODY = `# Welcome to your knowledge base

This is your first entry. You can edit it directly here, or connect your agent to read, edit, and create entries automatically.

To enable agent edits, open this knowledge base's settings and turn on **Agent: write** for the base.
`;

interface Props {
  workspaceId: string;
  workspaceSegment: string;
  currentBaseId: string;
}

/**
 * KB switcher shown at the top of the knowledge tree pane. Lists every
 * knowledge base in the workspace, grouped Shared (public) on top and
 * Private below, with the current one highlighted. Replaces the old
 * sidebar KB sub-list. Includes the "+ New knowledge base" affordance.
 */
export function KnowledgeBaseSwitcher({
  workspaceId,
  workspaceSegment,
  currentBaseId,
}: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const { data: bases, refetch } = useKnowledgeBases(workspaceId);
  useKnowledgeRealtime(workspaceId, refetch);

  const access = useMyAccessContext();
  const canCreate =
    access.data == null ? true : meetsLevel(access.data.defaultLevel, "edit");

  const list = bases ?? [];
  const shared = list.filter((kb) => kb.visibility === "public");
  const privateList = list.filter((kb) => kb.visibility === "private");

  async function handleAddNew() {
    if (!workspaceSegment || !workspaceId || creating) return;
    setCreating(true);
    try {
      const base = await apiCreateBase(
        { name: "Untitled", description: null, agentWriteEnabled: false },
        workspaceId
      );
      try {
        await apiCreateEntry(
          base.id,
          {
            folderId: null,
            title: "README",
            excerpt: null,
            body: DEFAULT_KB_README_BODY,
            entryType: "note",
            position: 0,
          },
          workspaceId
        );
      } catch {
        // Non-fatal — base exists, user can add entries manually.
      }
      refetch();
      access.refetch();
      router.push(
        `/${workspaceSegment}/knowledge/${base.slug}-${base.publicId}`
      );
    } catch (err) {
      toast({
        title: "Couldn't create knowledge base",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="shrink-0 max-h-[45%] overflow-y-auto px-2 py-2 border-b border-border-subtle">
      <Group
        label="Shared"
        icon={Users}
        bases={shared}
        currentBaseId={currentBaseId}
        workspaceSegment={workspaceSegment}
      />
      <Group
        label="Private"
        icon={Lock}
        bases={privateList}
        currentBaseId={currentBaseId}
        workspaceSegment={workspaceSegment}
      />
      {canCreate && (
        <button
          type="button"
          onClick={handleAddNew}
          disabled={creating}
          className="mt-1 w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[13px] text-text-secondary/70 hover:text-text-primary hover:bg-surface-raised-2 transition-colors cursor-pointer disabled:opacity-50"
        >
          <Plus size={13} className="shrink-0" />
          New knowledge base
        </button>
      )}
    </div>
  );
}

function Group({
  label,
  icon: Icon,
  bases,
  currentBaseId,
  workspaceSegment,
}: {
  label: string;
  icon: typeof Lock;
  bases: KnowledgeBase[];
  currentBaseId: string;
  workspaceSegment: string;
}) {
  if (bases.length === 0) return null;
  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50">
        <Icon size={11} className="shrink-0" />
        {label}
      </div>
      <div className="flex flex-col gap-0.5">
        {bases.map((kb) => {
          const active = kb.id === currentBaseId;
          return (
            <Link
              key={kb.id}
              href={`/${workspaceSegment}/knowledge/${kb.slug}-${kb.publicId}`}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-[13px] transition-colors cursor-pointer",
                active
                  ? "bg-surface-selected text-text-primary"
                  : "text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary"
              )}
            >
              <span className="truncate flex-1">{kb.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
