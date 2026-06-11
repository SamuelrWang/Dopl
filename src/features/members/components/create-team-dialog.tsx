"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { cn } from "@/shared/lib/utils";
import appShell from "@/shared/layout/app-shell/app-shell.module.css";
import type { AccessMatrixResource } from "@/features/teams/types";
import type { AccessLevel } from "@/features/teams/access-levels";
import type { WorkspaceMemberView } from "../types";
import { DEFAULT_TEAM_COLOR } from "../constants";
import { TeamAccessConflictError, createTeam } from "../teams-client";
import type { ConflictState } from "./conflict-dialog";
import { Avatar } from "./member-bits";
import { AccessLevelControl, ColorSwatchPicker } from "./team-bits";

interface Props {
  workspaceSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: WorkspaceMemberView[];
  resources: AccessMatrixResource[];
  currentUserId: string;
  onCreated: () => void;
  openConflict: (conflict: ConflictState) => void;
}

/**
 * Create-team flow: name, color swatch, member multi-pick, and initial
 * per-resource access levels (knowledge bases + workflows).
 */
export function CreateTeamDialog({
  workspaceSlug,
  open,
  onOpenChange,
  members,
  resources,
  currentUserId,
  onCreated,
  openConflict,
}: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_TEAM_COLOR);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [grants, setGrants] = useState<Map<string, AccessLevel>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickable = members.filter(
    (m) => m.status === "active" && m.userId !== currentUserId
  );

  function reset() {
    setName("");
    setColor(DEFAULT_TEAM_COLOR);
    setSelected(new Set());
    setGrants(new Map());
    setError(null);
    setSubmitting(false);
  }

  function toggleMember(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function setGrant(key: string, level: AccessLevel | null) {
    setGrants((prev) => {
      const next = new Map(prev);
      if (level === null) next.delete(key);
      else next.set(key, level);
      return next;
    });
  }

  async function submit(autoGrant: boolean) {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Team name required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createTeam(workspaceSlug, {
        name: trimmed,
        color,
        memberIds: [...selected],
        grants: [...grants.entries()].map(([key, level]) => {
          const [resourceType, resourceId] = key.split("|") as [
            "knowledge_base" | "workflow",
            string,
          ];
          return { resourceType, resourceId, level };
        }),
        autoGrant: autoGrant || undefined,
      });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      if (err instanceof TeamAccessConflictError) {
        openConflict({
          details: err.details,
          retry: async () => {
            await submit(true);
          },
        });
        return;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      {/* lightScope: dialog portals to <body>, escaping the page's light
          token scope — re-apply it so the popup matches the page. */}
      <DialogContent
        showCloseButton={false}
        className={cn(
          appShell.lightScope,
          "sm:max-w-lg bg-modal-surface border-border-strong text-text-primary"
        )}
      >
        <div className="flex flex-col items-center text-center gap-1.5 pt-2">
          <DialogTitle className="text-text-primary text-lg">Create team</DialogTitle>
          <p className="text-sm text-text-tertiary">
            Group members and control which resources they can reach
          </p>
        </div>

        <div className="flex flex-col gap-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-tertiary">Team name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Outreach, Engineering, Research"
              autoFocus
              className="h-10 px-3 rounded-md bg-surface-raised-2 border border-border-strong text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-tertiary">Color</span>
            <ColorSwatchPicker value={color} onChange={setColor} />
          </div>

          {pickable.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-tertiary">Add members</span>
              <ul className="rounded-md border border-border-strong divide-y divide-border-subtle overflow-hidden max-h-44 overflow-y-auto bg-surface-raised-1">
                {pickable.map((m) => {
                  const on = selected.has(m.userId);
                  return (
                    <li key={m.userId}>
                      <button
                        type="button"
                        onClick={() => toggleMember(m.userId)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-raised-2 transition-colors cursor-pointer"
                      >
                        <Avatar person={m} size="xs" />
                        <span className="flex-1 text-xs text-text-primary truncate">
                          {m.displayName || m.email || m.userId}
                        </span>
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                            on
                              ? "bg-accent-primary border-accent-primary text-accent-on"
                              : "border-border-strong text-transparent"
                          )}
                        >
                          <Check size={10} strokeWidth={3} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {resources.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-tertiary">
                Resource access
              </span>
              <ul className="rounded-md border border-border-strong divide-y divide-border-subtle overflow-hidden max-h-44 overflow-y-auto bg-surface-raised-1">
                {resources.map((r) => {
                  const key = `${r.resourceType}|${r.resourceId}`;
                  return (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="text-xs text-text-primary truncate">{r.name}</span>
                      <AccessLevelControl
                        value={grants.get(key) ?? null}
                        onChange={(level) => setGrant(key, level)}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex flex-col gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={submitting || name.trim() === ""}
            className="h-10 rounded-md bg-accent-primary text-accent-on text-sm font-medium hover:bg-accent-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {submitting ? "Creating…" : "Create team"}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-raised-2 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
