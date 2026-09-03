"use client";

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
import { KnowledgeApiError, createBase } from "../client/api";
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
   * WHICH SHELF this dialog writes to (`../types.ts › KbShelf`). Omitted = the
   * WORKSPACE shelf, which is the workspace Knowledge page and every other
   * caller. `"home"` is passed by the /home Knowledge pane on its "across all
   * channels" scope, and it does TWO things that must stay together: it sends
   * `homeScoped: true` so the row lands on the shelf, and it seeds the cache
   * entry keyed by that same shelf. Sending one without the other creates a
   * base the surface that created it cannot see (§8).
   *
   * ⚠ A REQUEST, NOT A GUARANTEE — `shared/tenancy/personal-container.ts ›
   * personalWriteWorkspaceId` 403s when the caller has no personal container to
   * write into, and the dialog surfaces that message rather than retrying
   * unmarked. ⚠ Since 2026-09-02 (slice B15) the flag ROUTES the row's
   * `workspace_id`; nothing stores it.
   */
  shelf?: KbShelf;
  /**
   * Create the base AND share it into this channel, atomically (Samuel's ruling
   * 2026-08-27 — the /home Shared section's create button). The server writes a
   * `channel_resource_grants` row at `level: 'visible'` and rolls the base back
   * if that fails, so this never half-lands.
   *
   * ⚠ IT ALSO REMOVES THE "WHO CAN ACCESS" PICKER, and that is not cosmetic:
   * the GRANT is the audience answer here, so leaving a workspace-visibility
   * radio beside it would offer a second, contradicting one. The base is created
   * `private` — private + a `visible` grant is precisely "readable in this
   * channel and nowhere else", which is what the button says.
   */
  shareToChannelId?: string;
  /**
   * THE AUDIENCE IS ALREADY DECIDED, so do not ask again (Samuel, 2026-08-27 —
   * the /home mounts). On /home the operator reached this dialog through a
   * button that named the audience — **Personal** or **Shared** — and a
   * private/public/team radio underneath would be a second answer to a question
   * already answered, in a surface where two of its three options do not apply
   * (a link container has no teams, §4A/§5A).
   *
   * ⚠ IT IS THE SAME RULE `shareToChannelId` ALREADY ENFORCES, named
   * separately because the two are not the same fact: a shared create carries a
   * channel grant, a personal one carries nothing but its shelf. The WORKSPACE
   * Knowledge page passes neither and keeps the picker — that page's create
   * button names no audience, so this is the only place its question is asked.
   */
  audienceFixed?: boolean;
  /** Where a freshly created base sends the user (./knowledge-v2/routing.ts). */
  routing: KnowledgeRouting;
}

/**
 * Create-knowledge-base dialog. THE standard dialog chrome
 * (`shared/ui/standard-dialog.tsx` — narrow width, centered uppercase heading,
 * pillow fields, fully-rounded footer pair), plus the three-way scope picker
 * where the caller has not already settled the audience. Server derives the
 * slug from the name.
 *
 * ⚠ NO EXPLAINER PARAGRAPH (2026-08-27). It carried one — what a knowledge base
 * holds, and that MCP can reach it — which is the copy the minimal-copy ruling
 * deletes and which none of the other three dialogs has. Label + control.
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

  // ⚠ ONE EXPRESSION, READ THREE TIMES — the render, the disabled guard and the
  // body below all ask "is the picker live?". Three copies of that condition is
  // how a hidden control starts contributing a scope to a write nobody chose.
  const scopePicker = !shareToChannelId && !audienceFixed;

  const createDisabled =
    submitting ||
    !name.trim() ||
    // ⚠ Only reachable when the picker is RENDERED; a create whose audience the
    // caller already settled never shows it, so it can never be blocked by a
    // team scope nobody chose.
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
          // ⚠ A CREATE WITH NO PICKER IS ALWAYS `private` ON THE WORKSPACE
          // AXIS — the button (or the grant) carries the audience, and `scope`
          // is not rendered at all in that mode, so reading it here would send
          // whatever the state happened to be initialised to.
          visibility:
            !scopePicker || scope === "private" ? "private" : "public",
          ...(scopePicker && scope === "team"
            ? { accessMode: "teams" as const, teamGrants }
            : {}),
          ...(shareToChannelId ? { shareToChannelId } : {}),
          // ⚠ Only ever SENT for the home shelf — an unconditional
          // `homeScoped: shelf === "home"` would put an explicit `false` on
          // every workspace-page create, which is the same row but a wider
          // contract for the fence to have to allow.
          ...(shelf === "home" ? { homeScoped: true } : {}),
        },
        workspaceId,
      );
      close();
      // ⚠ Seed BEFORE navigating: the controller resolves the URL segment it
      // is about to see against the cached base list, and the
      // `refreshServerData` refetch has not landed yet.
      // ⚠ SAME SHELF THE PROP NAMES — see the `shelf` prop's docblock.
      seedKnowledgeBase(queryClient, workspaceId, base, shelf);
      routing.goToBase(base, "push");
      routing.refreshServerData();
    } catch (err) {
      const msg =
        err instanceof KnowledgeApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong";
      setError(msg);
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

      {/* ⚠ HIDDEN WHEREVER THE CALLER ALREADY NAMED THE AUDIENCE — see the
          `shareToChannelId` and `audienceFixed` props. One audience question,
          asked once. */}
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
