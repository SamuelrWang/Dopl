"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KB_BASE_DESCRIPTION_MAX } from "@/config";
import { cn } from "@/shared/lib/utils";
import {
  DialogActions,
  DialogField,
  DIALOG_BTN_PRIMARY,
  DIALOG_BTN_SECONDARY,
  StandardDialog,
} from "@/shared/ui/standard-dialog";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { useTeams } from "@/features/members/hooks/use-teams";
import type { KbScope } from "../scope";
import type { KbShelf } from "../types";
import { createBase } from "../client/api";
import { seedKnowledgeBase } from "../client/hooks";
import type { KnowledgeRouting } from "./knowledge-v2/routing";
import {
  ScopeSelector,
  TeamGrantEditor,
  type TeamGrantDraft,
} from "./kb-scope-controls";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  /**
   * Which shelf this dialog writes to (`../types.ts › KbShelf`). Omitted = the
   * workspace shelf. `"home"` does TWO things that must stay together: it sends
   * `homeScoped: true` so the row lands on the shelf, and it seeds the cache
   * entry keyed by that same shelf. One without the other creates a base the
   * surface that created it cannot see (§8).
   *
   * A request, not a guarantee — `shared/tenancy/home-space.ts ›
   * homeSpaceWriteWorkspaceId` 403s when the caller has no home space,
   * and the dialog surfaces that message rather than retrying unmarked.
   */
  shelf?: KbShelf;
  /**
   * Create the base AND share it into this channel, atomically (Samuel's ruling
   * 2026-08-27 — the /home Shared section's create button). The server writes a
   * `channel_resource_grants` row at `level: 'visible'` and rolls the base back
   * if that fails, so this never half-lands.
   *
   * It also removes the "Who can access" picker: the grant is the audience
   * answer, so a workspace-visibility radio beside it would contradict. The base
   * is created `private` — private + a `visible` grant is "readable in this
   * channel and nowhere else".
   */
  shareToChannelId?: string;
  /**
   * The audience is already decided, so do not ask again (Samuel, 2026-08-27):
   * on /home the operator reached this dialog through a button that named it,
   * and two of the radio's three options do not apply (a link container has no
   * teams, §4A/§5A).
   *
   * Same rule `shareToChannelId` enforces, named separately because the facts
   * differ: a shared create carries a channel grant, a personal one carries only
   * its shelf. The workspace Knowledge page passes neither and keeps the picker.
   */
  audienceFixed?: boolean;
  /** Where a freshly created base sends the user (./knowledge-v2/routing.ts). */
  routing: KnowledgeRouting;
}

/**
 * Create-knowledge-base dialog: the standard dialog chrome
 * (`shared/ui/standard-dialog.tsx`) plus the three-way scope picker where the
 * caller has not already settled the audience. Server derives the slug.
 *
 * No explainer paragraph (2026-08-27 minimal-copy ruling): label + control.
 */
export function CreateBaseDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
  shelf,
  shareToChannelId,
  audienceFixed,
  routing,
}: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<KbScope>("private");
  const [teamGrants, setTeamGrants] = useState<TeamGrantDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDescription("");
    setScope("private");
    setTeamGrants([]);
    setError(null);
    setSubmitting(false);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  // one expression, read three times (render, disabled guard, request body) —
  // duplicating it is how a hidden control contributes a scope nobody chose.
  const scopePicker = !shareToChannelId && !audienceFixed;

  const createDisabled =
    submitting ||
    !name.trim() ||
    // only reachable when the picker is rendered, so a create whose audience
    // the caller settled cannot be blocked by a team scope nobody chose.
    (scopePicker && scope === "team" && teamGrants.length === 0);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || createDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const base = await createBase(
        {
          name: trimmed,
          description: description.trim() || undefined,
          // a create with no picker is always `private` on the workspace axis:
          // `scope` is not rendered in that mode, so reading it would send
          // whatever the state was initialised to.
          visibility:
            !scopePicker || scope === "private" ? "private" : "public",
          ...(scopePicker && scope === "team"
            ? { accessMode: "teams" as const, teamGrants }
            : {}),
          ...(shareToChannelId ? { shareToChannelId } : {}),
          // only ever sent for the home shelf — an explicit `false` on every
          // workspace-page create is a wider contract for the fence to allow.
          ...(shelf === "home" ? { homeScoped: true } : {}),
        },
        workspaceId,
      );
      close();
      // seed BEFORE navigating: the controller resolves the URL segment it is
      // about to see against the cached base list, and `refreshServerData` has
      // not landed yet. Same shelf the prop names.
      seedKnowledgeBase(queryClient, workspaceId, base, shelf);
      routing.goToBase(base, "push");
      routing.refreshServerData();
    } catch (err) {
      setError(userFacingMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <StandardDialog open={open} onClose={close} title="New knowledge base">
      <DialogField label="Name" htmlFor="create-base-name">
        <input
          id="create-base-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Product specs"
          autoFocus
          className={cn(RAISED_INPUT, "h-9 px-3")}
        />
      </DialogField>

      <DialogField
        label="Description"
        hint="(optional)"
        htmlFor="create-base-description"
      >
        <textarea
          id="create-base-description"
          value={description}
          onChange={(e) =>
            setDescription(e.target.value.slice(0, KB_BASE_DESCRIPTION_MAX))
          }
          placeholder="What lives in this knowledge base?"
          rows={3}
          maxLength={KB_BASE_DESCRIPTION_MAX}
          className={cn(RAISED_INPUT, "resize-none px-3 py-2")}
        />
      </DialogField>

      {/* hidden wherever the caller already named the audience — see the
          `shareToChannelId` and `audienceFixed` props. */}
      {scopePicker && (
        <DialogField label="Who can access">
          <ScopePicker
            workspaceSlug={workspaceSlug}
            currentUserId={currentUserId}
            role={role}
            scope={scope}
            onScopeChange={setScope}
            teamGrants={teamGrants}
            onTeamGrantsChange={setTeamGrants}
          />
        </DialogField>
      )}

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}

      <DialogActions>
        <button type="button" className={DIALOG_BTN_SECONDARY} onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className={DIALOG_BTN_PRIMARY}
          onClick={handleCreate}
          disabled={createDisabled}
        >
          {submitting ? "Creating…" : "Create"}
        </button>
      </DialogActions>
    </StandardDialog>
  );
}

/**
 * Scope radio + (Teams only) grant editor. `useTeams` mounts lazily so the
 * landing page doesn't fetch teams for everyone.
 */
function ScopePicker({
  workspaceSlug,
  currentUserId,
  role,
  scope,
  onScopeChange,
  teamGrants,
  onTeamGrantsChange,
}: {
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  scope: KbScope;
  onScopeChange: (next: KbScope) => void;
  teamGrants: TeamGrantDraft[];
  onTeamGrantsChange: (next: TeamGrantDraft[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ScopeSelector value={scope} onChange={onScopeChange} />
      {scope === "team" ? (
        <TeamGrantPane
          workspaceSlug={workspaceSlug}
          currentUserId={currentUserId}
          role={role}
          grants={teamGrants}
          onChange={onTeamGrantsChange}
        />
      ) : null}
    </div>
  );
}

function TeamGrantPane({
  workspaceSlug,
  currentUserId,
  role,
  grants,
  onChange,
}: {
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  grants: TeamGrantDraft[];
  onChange: (next: TeamGrantDraft[]) => void;
}) {
  const { teams, loading, error } = useTeams(workspaceSlug);
  if (loading) {
    return <p className="text-small text-text-secondary">Loading teams…</p>;
  }
  if (error) {
    return <p className="text-small text-danger">{error}</p>;
  }
  const pickable = meetsMinRole(role, "admin")
    ? (teams ?? [])
    : (teams ?? []).filter((t) => t.memberIds.includes(currentUserId));
  if (pickable.length === 0) {
    return (
      <p className="text-small text-text-secondary">
        {meetsMinRole(role, "admin")
          ? "No teams in this workspace yet — create one from settings → Members."
          : "You're not in any team yet — ask an admin to add you, or pick another scope."}
      </p>
    );
  }
  return (
    <TeamGrantEditor teams={pickable} grants={grants} onChange={onChange} />
  );
}
