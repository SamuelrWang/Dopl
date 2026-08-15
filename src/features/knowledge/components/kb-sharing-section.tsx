"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/shared/ui/toast";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { useTeams } from "@/features/members/hooks/use-teams";
import { updateBase } from "../client/api";
import { kbScope, type KbScope } from "../scope";
import type { KnowledgeBase } from "../types";
import type { KnowledgeRouting } from "./knowledge-v2/routing";
import {
  ScopeSelector,
  TeamGrantEditor,
  type TeamGrantDraft,
} from "./kb-scope-controls";

interface Props {
  workspaceId: string;
  workspaceSlug: string;
  base: KnowledgeBase;
  currentUserId: string;
  role: Role;
  /** Scope changes move a KB in and out of other members' lists, which the
   *  page's owner/team data is derived from — see ./knowledge-v2/routing.ts. */
  routing: KnowledgeRouting;
}

/**
 * Settings → Sharing: the three-way scope picker + per-team grant
 * editor. Editable by the KB owner or a workspace admin (mirrors the
 * service-side `ScopeChangeForbiddenError` rule); everyone else gets a
 * read-only summary.
 *
 * Narrowing used to be able to 409 against the workflow↔KB invariant, opening
 * a shared conflict dialog. Workflows were deleted on 2026-08-11 and that was
 * the status's only producer, so a save now either applies or fails as itself.
 */
export function KbSharingSection({
  workspaceId,
  workspaceSlug,
  base,
  currentUserId,
  role,
  routing,
}: Props) {
  const isAdmin = meetsMinRole(role, "admin");
  const canManage = base.createdBy === currentUserId || isAdmin;
  const { teams, loading: teamsLoading, error: teamsError } =
    useTeams(workspaceSlug);

  const [scope, setScope] = useState<KbScope>(kbScope(base));
  const [grants, setGrants] = useState<TeamGrantDraft[]>([]);
  const [grantsSeeded, setGrantsSeeded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Current grants live on TeamView.grants — seed the draft once the
  // teams fetch lands (the modal mounts this section only while open).
  const currentGrants = useMemo<TeamGrantDraft[]>(
    () =>
      (teams ?? []).flatMap((t) =>
        t.grants
          .filter(
            (g) =>
              g.resourceType === "knowledge_base" && g.resourceId === base.id
          )
          .map((g) => ({ teamId: t.id, level: g.level }))
      ),
    [teams, base.id]
  );
  useEffect(() => {
    if (teams && !grantsSeeded) {
      setGrants(currentGrants);
      setGrantsSeeded(true);
    }
  }, [teams, grantsSeeded, currentGrants]);

  // Members may add/raise only their own teams; admin-granted foreign
  // teams render locked. Admins see and edit everything.
  const myTeamIds = useMemo(
    () =>
      new Set(
        (teams ?? [])
          .filter((t) => t.memberIds.includes(currentUserId))
          .map((t) => t.id)
      ),
    [teams, currentUserId]
  );
  const visibleTeams = useMemo(() => {
    const all = teams ?? [];
    if (isAdmin) return all;
    const grantedIds = new Set(currentGrants.map((g) => g.teamId));
    return all.filter((t) => myTeamIds.has(t.id) || grantedIds.has(t.id));
  }, [teams, isAdmin, myTeamIds, currentGrants]);
  const lockedTeamIds = useMemo(() => {
    if (isAdmin) return undefined;
    return new Set(visibleTeams.filter((t) => !myTeamIds.has(t.id)).map((t) => t.id));
  }, [isAdmin, visibleTeams, myTeamIds]);

  const dirty =
    scope !== kbScope(base) ||
    (scope === "team" && !sameGrants(grants, currentGrants));

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await updateBase(
        base.id,
        scope === "private"
          ? { visibility: "private" }
          : scope === "team"
            ? { visibility: "public", accessMode: "teams", teamGrants: grants }
            : { visibility: "public", accessMode: "workspace" },
        workspaceId
      );
      toast({ title: "Sharing updated" });
      routing.refreshServerData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't update sharing";
      toast({ title: "Couldn't update sharing", description: msg });
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <p className="text-caption text-text-secondary leading-relaxed">
        {kbScope(base) === "team"
          ? "Shared with specific teams. Only the owner or a workspace admin can change sharing."
          : kbScope(base) === "private"
            ? "Private to its owner."
            : "Public to the whole workspace. Only the owner or a workspace admin can change sharing."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ScopeSelector
        value={scope}
        onChange={setScope}
        disabled={saving}
        teamsDisabled={!isAdmin && myTeamIds.size === 0 && currentGrants.length === 0}
      />

      {scope === "team" ? (
        teamsLoading ? (
          <p className="text-small text-text-secondary">Loading teams…</p>
        ) : teamsError ? (
          <p className="text-small text-danger">{teamsError}</p>
        ) : (
          <>
            <TeamGrantEditor
              teams={visibleTeams}
              grants={grants}
              onChange={setGrants}
              disabled={saving}
              lockedTeamIds={lockedTeamIds}
            />
            {grants.length === 0 ? (
              <p className="text-caption text-warning">
                No teams granted — only you and workspace admins will see
                this knowledge base. Consider switching to Private instead.
              </p>
            ) : null}
          </>
        )
      ) : null}

      {scope === "private" && kbScope(base) !== "private" ? (
        <p className="text-caption text-text-secondary">
          Making this private removes all team grants — only you (and
          workspace admins via settings) will see it.
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="h-8 px-4 rounded-md bg-surface-cta text-text-on-cta text-small font-medium hover:bg-surface-cta/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving…" : "Update sharing"}
        </button>
      </div>
    </div>
  );
}

function sameGrants(a: TeamGrantDraft[], b: TeamGrantDraft[]): boolean {
  if (a.length !== b.length) return false;
  const map = new Map(b.map((g) => [g.teamId, g.level]));
  return a.every((g) => map.get(g.teamId) === g.level);
}
