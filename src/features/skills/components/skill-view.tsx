"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, History } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EditableTitle } from "@/shared/layout/editable-title";
import { useMyAccessContext } from "@/features/members/hooks/use-my-access";
import { meetsLevel } from "@/features/teams/access-levels";
import { useRefetchOnFocus } from "@/shared/hooks/use-refetch-on-focus";
import { useCurrentProfile } from "@/shared/auth/use-current-profile";
import { usePresence } from "@/shared/realtime/use-presence";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { toast } from "@/shared/ui/toast";
import { DocEditor, SaveStatusIndicator } from "@/shared/editor/doc-editor";
import {
  type ResolvedSkill,
  type Skill,
  type SkillFile,
} from "@/features/skills/types";
import { deleteSkill } from "@/features/skills/client/api";
import { useSkillConflict } from "../hooks/use-skill-conflict";
import { useSkillMetadata } from "../hooks/use-skill-metadata";
import { useSkillSaveChain } from "../hooks/use-skill-save-chain";
import { useSkillsRealtime } from "../client/realtime";
import { SkillFolderControl } from "./skill-folder-control";
import { SkillHeaderActions } from "./skill-header-actions";
import { SkillHistoryPanel } from "./skill-history-panel";
import { SkillShareControl } from "./skill-share-control";
import { errMessage, primaryFile } from "./skill-view-utils";

interface Props {
  resolved: ResolvedSkill;
  workspaceSlug: string;
  /** ⚠ Every client call must carry this as the X-Workspace-Id header so
   *  the route targets THIS workspace, not the caller's default. */
  workspaceId: string;
  /** With `currentUserId`, gates the sharing control (owner or admin). */
  isAdmin: boolean;
  currentUserId: string;
  onDuplicated?: (skill: Skill) => void;
  /** Permanent delete landed. Browser owns what happens next; this pane is
   *  unmounted by that reselection, so it must NOT also refresh itself. */
  onDeleted?: (skillId: string) => void;
  /** Parent list rendering changed (rename, refolder, duplicate). Injected
   *  rather than calling a router, to stay Next-free: web passes
   *  `router.refresh()`, desktop SPA passes TanStack `invalidateQueries`
   *  (apps/desktop-ui/CONVENTIONS.md). */
  onListChanged?: () => void;
}

/**
 * Skill editor pane, inline in the skills browser (no separate route).
 * Single-document editor for the one SKILL.md. Body autosaves after 1.5s
 * idle, with the KB editor's optimistic-concurrency (412) conflict flow.
 * Orchestration + layout only; machinery in three sibling hooks —
 * `use-skill-metadata` (header CAS clock), `use-skill-conflict` (412
 * record), `use-skill-save-chain` (serialized body writes).
 * ⚠ Parent must key this by skill id so switching skills remounts state.
 */
export function SkillView({
  resolved,
  workspaceSlug,
  workspaceId,
  isAdmin,
  currentUserId,
  onDuplicated,
  onDeleted,
  onListChanged,
}: Props) {
  const { skill } = resolved;

  // Write affordances gated on effective access. Falls open to true while
  // access is still loading.
  const access = useMyAccessContext();
  const accessLevel = access.resolve("skill", skill.id);
  const canEdit = accessLevel == null ? true : meetsLevel(accessLevel, "edit");
  // Delete is permanent (no trash/restore) → OWNERSHIP gate (creator or
  // workspace admin), not the edit gate. Strictly narrower than the server,
  // which allows any member who can see the skill, so nothing rendered 403s.
  const canDelete =
    canEdit && (skill.createdBy === currentUserId || isAdmin);

  const initialFile = useMemo(() => primaryFile(resolved.files), [resolved.files]);
  const [file, setFile] = useState<SkillFile>(initialFile);
  // ⚠ Editor owns its content while typing. Re-seed ONLY on user-driven
  // reload ("Discard mine") or an at-rest server pull — never on save
  // success: that clobbers keystrokes typed while the PUT was in flight.
  const [editorMd, setEditorMd] = useState(initialFile.body);
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Bumped whenever a save lands so the open history panel refetches.
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const {
    displayed,
    rename,
    refile,
    reshare,
    pullLatest,
    adoptBaseline: adoptMetaBaseline,
  } = useSkillMetadata({ skill, workspaceId, onListChanged });

  // 412 from the autosave path. While set, autosave is paused and the
  // banner's Save mine / Discard mine buttons are the only way forward.
  const {
    conflict,
    peek: peekConflict,
    capture: captureConflict,
    clear: clearConflict,
  } = useSkillConflict(skill.slug, workspaceId);

  const onAutosaved = useCallback(
    (saved: SkillFile, skillUpdatedAt: string) => {
      adoptMetaBaseline(skillUpdatedAt);
      setFile(saved);
      setHistoryRefreshKey((k) => k + 1);
    },
    [adoptMetaBaseline]
  );
  const onOverwritten = useCallback(
    (saved: SkillFile, skillUpdatedAt: string) => {
      adoptMetaBaseline(skillUpdatedAt);
      setFile(saved);
      clearConflict();
    },
    [adoptMetaBaseline, clearConflict]
  );

  const {
    saveStatus,
    scheduleSave,
    saveOverriding,
    cancelPendingSave,
    discardPending,
    adoptBaseline: adoptBodyBaseline,
    isAtRest,
    hasPendingEdit,
  } = useSkillSaveChain({
    slug: skill.slug,
    workspaceId,
    initialUpdatedAt: initialFile.updatedAt,
    peekConflict,
    captureConflict,
    onAutosaved,
    onOverwritten,
  });

  const selfProfile = useCurrentProfile();
  const presencePeers = usePresence(
    `presence:skill:${skill.id}`,
    selfProfile,
    saveStatus === "dirty" || saveStatus === "saving"
  );
  const otherEditors = presencePeers.filter(
    (p) => p.userId !== selfProfile?.userId
  );

  // Re-seeds Tiptap via the reload key. ⚠ Callers own the safety check —
  // user chose to discard, or editor is at rest.
  const reloadEditor = useCallback((body: string) => {
    setEditorMd(body);
    setEditorReloadKey((k) => k + 1);
  }, []);

  const handleDiscardMine = useCallback(() => {
    const c = peekConflict();
    if (!c) return;
    discardPending(c.serverUpdatedAt);
    setFile((prev) => ({
      ...prev,
      body: c.serverBody,
      updatedAt: c.serverUpdatedAt,
    }));
    reloadEditor(c.serverBody);
    clearConflict();
  }, [clearConflict, discardPending, peekConflict, reloadEditor]);

  // ⚠ Callers MUST ensure the editor is at rest first: this replaces the
  // Tiptap content, so a mid-edit pull yanks the document out from under
  // the user.
  const pullFreshSkill = useCallback(async () => {
    const fresh = await pullLatest();
    if (!fresh) return;
    const next = primaryFile(fresh.files);
    adoptBodyBaseline(next.updatedAt);
    setFile(next);
    reloadEditor(next.body);
  }, [adoptBodyBaseline, pullLatest, reloadEditor]);

  // Refocus pull: picks up saves from another tab or an MCP agent. Skipped
  // mid-save.
  useRefetchOnFocus(pullFreshSkill, { skip: hasPendingEdit });

  // Realtime (Tier 2). Order matters: bump history key first — the version
  // rail refetches regardless of editor state — then pull the body only
  // when at rest, so a remote change never remounts the active editor.
  const onRealtimeChange = useCallback(() => {
    setHistoryRefreshKey((k) => k + 1);
    if (!isAtRest()) return;
    void pullFreshSkill();
  }, [isAtRest, pullFreshSkill]);
  useSkillsRealtime(skill.workspaceId, onRealtimeChange);

  const updateBody = useCallback(
    (body: string) => {
      setFile((prev) => ({ ...prev, body }));
      scheduleSave(body);
    },
    [scheduleSave]
  );

  // Permanent delete. Rethrow is load-bearing: ConfirmDialog stays open on
  // rejection, so the user can retry or cancel after the toast.
  const handleDelete = useCallback(async () => {
    // ⚠ Drop buffered autosave FIRST — the unmount flush would otherwise
    // PUT the body into a row that no longer exists.
    cancelPendingSave();
    try {
      await deleteSkill(skill.slug, workspaceId);
    } catch (err) {
      toast({ title: "Couldn't delete", description: errMessage(err) });
      throw err;
    }
    toast({ title: "Skill deleted", description: displayed.name });
    onDeleted?.(skill.id);
  }, [
    cancelPendingSave,
    displayed.name,
    onDeleted,
    skill.id,
    skill.slug,
    workspaceId,
  ]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col antialiased">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <EditableTitle
            value={displayed.name}
            onSave={rename}
            onError={(err) =>
              toast({ title: "Couldn't rename", description: errMessage(err) })
            }
            placeholder="Untitled skill"
          />
          <SkillFolderControl
            folder={displayed.folder}
            canEdit={canEdit}
            onSave={refile}
          />
          <SkillShareControl
            skill={{ ...skill, ...displayed.sharing }}
            workspaceSlug={workspaceSlug}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            onShareChange={reshare}
          />
        </div>
        <AvatarStack users={otherEditors} />
        <SaveStatusIndicator state={saveStatus} />
        <SkillHeaderActions
          slug={skill.slug}
          workspaceId={workspaceId}
          canEdit={canEdit}
          onDuplicated={onDuplicated}
          onListChanged={onListChanged}
          onDelete={canDelete ? handleDelete : undefined}
        />
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          aria-pressed={historyOpen}
          className={cn(
            "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-small font-medium transition-colors",
            historyOpen
              ? "raised-tab text-text-primary"
              : "btn-light text-text-primary"
          )}
        >
          <History size={12} />
          History
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <div className="h-full overflow-hidden flex">
          {/* Main column */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto">
              {conflict && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-2 border-b border-warning/25 bg-warning/5 px-4 py-2 text-small leading-relaxed text-text-primary"
                >
                  <AlertTriangle size={13} className="shrink-0 text-warning" />
                  <span className="min-w-0 flex-1">
                    <strong className="font-semibold">Edited elsewhere.</strong>{" "}
                    The server has a newer version of this skill — your edits
                    are preserved until you choose.
                  </span>
                  <button
                    type="button"
                    onClick={handleDiscardMine}
                    disabled={saveStatus === "saving"}
                    className="btn-light rounded-md px-2.5 py-1 text-caption text-text-primary disabled:opacity-40"
                  >
                    Discard mine, reload
                  </button>
                  <button
                    type="button"
                    onClick={saveOverriding}
                    disabled={saveStatus === "saving"}
                    className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:bg-warning/15 disabled:opacity-40"
                  >
                    {saveStatus === "saving" ? "Saving…" : "Save mine, overwrite"}
                  </button>
                </div>
              )}
              <DocEditor
                // ⚠ Bumps ONLY on explicit reloads. Never on save success.
                resetKey={`${file.id}:${editorReloadKey}`}
                initialMarkdown={editorMd}
                onChange={updateBody}
              />
            </div>
          </div>

          {historyOpen && (
            <SkillHistoryPanel
              slug={skill.slug}
              workspaceId={workspaceId}
              canEdit={canEdit}
              refreshKey={historyRefreshKey}
              onClose={() => setHistoryOpen(false)}
              onRestored={() => {
                setHistoryRefreshKey((k) => k + 1);
                if (isAtRest()) void pullFreshSkill();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
