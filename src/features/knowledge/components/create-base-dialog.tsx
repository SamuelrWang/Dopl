"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { KB_BASE_DESCRIPTION_MAX } from "@/config";
// Deep import, not the `settings-modal` barrel — the barrel re-exports
// SettingsModal, which is Next-coupled (see base-settings-modal.tsx).
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { useTeams } from "@/features/members/hooks/use-teams";
import type { KbScope } from "../scope";
import { KnowledgeApiError, createBase } from "../client/api";
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
  /** Where a freshly created base sends the user — see
   *  ./knowledge-v2/routing.ts. */
  routing: KnowledgeRouting;
}

/**
 * Create-knowledge-base dialog in the new design language: the shared
 * ModalShell (scrim + fade/pop-in light card) in its narrow size — same
 * chrome as `BaseSettingsModal`. Includes the three-way sharing scope
 * picker (private / teams / workspace); server derives the slug from
 * the name.
 */
export function CreateBaseDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
  routing,
}: Props) {
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

  const createDisabled =
    submitting ||
    !name.trim() ||
    (scope === "team" && teamGrants.length === 0);

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
          visibility: scope === "private" ? "private" : "public",
          ...(scope === "team"
            ? { accessMode: "teams" as const, teamGrants }
            : {}),
        },
        workspaceId
      );
      close();
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
    <ModalShell
      open={open}
      onClose={close}
      label="New knowledge base"
      size="narrow"
    >
      <button
        type="button"
        className={modalStyles.close}
        onClick={close}
        aria-label="Close"
      >
        <X size={18} />
      </button>
      <div className={modalStyles.narrowBody}>
        <h2 className={modalStyles.narrowTitle} style={{ textAlign: "center" }}>New knowledge base</h2>
        <p className="mb-6 text-lead leading-relaxed text-text-secondary">
          A knowledge base holds folders + files. Editable in the browser,
          also accessible to your agent over MCP once you flip the
          agent-write toggle in settings.
        </p>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-label font-medium text-text-tertiary uppercase tracking-wider">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Product specs"
              autoFocus
              className="h-9 px-3 rounded-md bg-surface-raised-3 border border-border-strong text-body text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-label font-medium text-text-tertiary uppercase tracking-wider">
              Description{" "}
              <span className="text-text-muted normal-case tracking-normal">
                (optional)
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) =>
                setDescription(e.target.value.slice(0, KB_BASE_DESCRIPTION_MAX))
              }
              placeholder="What lives in this knowledge base?"
              rows={3}
              maxLength={KB_BASE_DESCRIPTION_MAX}
              className="px-3 py-2 rounded-md bg-surface-raised-3 border border-border-strong text-body text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors resize-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-label font-medium text-text-tertiary uppercase tracking-wider">
              Who can access
            </label>
            <ScopePicker
              workspaceSlug={workspaceSlug}
              currentUserId={currentUserId}
              role={role}
              scope={scope}
              onScopeChange={setScope}
              teamGrants={teamGrants}
              onTeamGrantsChange={setTeamGrants}
            />
          </div>

          {error && <p className="text-small text-danger">{error}</p>}
        </div>

        <div className={modalStyles.confirmActions}>
          <button
            type="button"
            className={modalStyles.btnCancel}
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            className={modalStyles.btnConfirm}
            onClick={handleCreate}
            disabled={createDisabled}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/**
 * Scope radio + (when Teams is selected) the grant editor. Loads teams
 * lazily — `useTeams` only mounts once the user opens the picker, so
 * the landing page doesn't fetch teams for everyone.
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
  return <TeamGrantEditor teams={pickable} grants={grants} onChange={onChange} />;
}
