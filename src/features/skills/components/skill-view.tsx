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
// Cross-feature imports: DocEditor + SourceIcon live in features/knowledge
// today. They're generic enough to belong in shared/ — moving is a future
// refactor (per ENGINEERING.md §3 / §16). Keeping the imports as-is for
// now matches the existing SourceIcon precedent in this file.
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
  /** Workspace being viewed. Every client call must carry it (as the
   *  X-Workspace-Id header) so the route targets THIS workspace and not
   *  the caller's default — see DetailPane's fetch note. */
  workspaceId: string;
  /** With `currentUserId`, gates the sharing control next to the title
   *  (owner or workspace admin). */
  isAdmin: boolean;
  currentUserId: string;
  /** Duplicate landed — the browser selects the new skill. */
  onDuplicated?: (skill: Skill) => void;
  /**
   * The skill was permanently deleted. The browser owns what happens next
   * (drop the row from its list, move the selection to a neighbour, re-pull)
   * — this pane is unmounted by that reselection, so it must not also try to
   * refresh itself.
   */
  onDeleted?: (skillId: string) => void;
  /**
   * Something that changes the PARENT's list rendering landed (rename,
   * refolder, duplicate). Injected instead of calling a router directly so
   * this component stays Next-free: the web app passes `router.refresh()`,
   * the desktop SPA passes a TanStack `invalidateQueries` — neither concept
   * exists in both apps (apps/desktop-ui/CONVENTIONS.md).
   */
  onListChanged?: () => void;
}

/**
 * The skill editor pane — rendered inline in the skills browser's
 * detail pane (no separate route).
 *
 * Skills are single-file: this is a single-document editor for the one
 * SKILL.md. Layout: title/share/save header, then the DocEditor for the
 * body. Body edits autosave after 1.5s of inactivity, with the same
 * optimistic-concurrency (412) conflict flow the KB editor uses. This file
 * is the orchestration and the layout; the machinery lives in three sibling
 * hooks — `use-skill-metadata` (the header bar's own CAS clock),
 * `use-skill-conflict` (the 412 record) and `use-skill-save-chain` (every
 * body write, serialized). Parent must key this component by skill id so
 * switching skills remounts fresh state.
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

  // Audit A-005 / A-013: gate write affordances on the caller's
  // effective access. Falls open to true while access is loading.
  const access = useMyAccessContext();
  const accessLevel = access.resolve("skill", skill.id);
  const canEdit = accessLevel == null ? true : meetsLevel(accessLevel, "edit");
  // Delete is permanent (§2b — no trash, no restore), so it takes the
  // OWNERSHIP gate the sharing control uses (creator or workspace admin),
  // not the broader edit gate that lets any member rewrite a shared skill.
  // Strictly narrower than the server, which allows any member who can see
  // the skill — so nothing we render can come back a 403.
  const canDelete =
    canEdit && (skill.createdBy === currentUserId || isAdmin);

  const initialFile = useMemo(() => primaryFile(resolved.files), [resolved.files]);
  const [file, setFile] = useState<SkillFile>(initialFile);
  // Markdown seed handed to DocEditor + explicit reload key. The editor
  // owns its content while typing; we re-seed ONLY on user-driven reload
  // ("Discard mine") or an at-rest server pull — never on save success,
  // which would clobber keystrokes typed while the PUT was in flight.
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

  // 412 surfaced from the autosave path. While set, the editor shows a
  // banner with explicit Save mine / Discard mine buttons; debounced
  // autosave is paused.
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

  // Presence: who else has this skill open, and whether they're editing.
  const selfProfile = useCurrentProfile();
  const presencePeers = usePresence(
    `presence:skill:${skill.id}`,
    selfProfile,
    saveStatus === "dirty" || saveStatus === "saving"
  );
  const otherEditors = presencePeers.filter(
    (p) => p.userId !== selfProfile?.userId
  );

  // Push a server body into the editor: re-seed the Tiptap state via the
  // explicit reload key. Callers own the safety check (user chose to
  // discard, or the editor is at rest).
  const reloadEditor = useCallback((body: string) => {
    setEditorMd(body);
    setEditorReloadKey((k) => k + 1);
  }, []);

  // Conflict resolution: discard local typing, reload the server body.
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

  // Pull the freshest skill + body from the server and replace local
  // state, including the editor seed. Callers MUST ensure the editor is
  // at rest first — a reload replaces the Tiptap content, so a mid-edit
  // pull would yank the document out from under the user.
  const pullFreshSkill = useCallback(async () => {
    const fresh = await pullLatest();
    if (!fresh) return;
    const next = primaryFile(fresh.files);
    adoptBodyBaseline(next.updatedAt);
    setFile(next);
    reloadEditor(next.body);
  }, [adoptBodyBaseline, pullLatest, reloadEditor]);

  // When the user switches back to this tab AND nothing is mid-save,
  // pull the freshest version so changes another tab or an MCP agent
  // saved while away show up automatically.
  useRefetchOnFocus(pullFreshSkill, { skip: hasPendingEdit });

  // Live updates (Tier 2): another user / MCP agent saving the body or
  // skill metadata, or writing a version, pushes here. Bump the history
  // key first (independent of the editor — the open version rail refetches
  // whether or not the editor is mid-edit), then pull the freshest body
  // only when the editor is fully at rest so a remote change never
  // remounts the active editor.
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

  // Permanent delete. Rejecting keeps the ConfirmDialog open (its contract),
  // so the user can retry or cancel after the toast.
  const handleDelete = useCallback(async () => {
    // Drop any buffered autosave FIRST: the unmount flush would otherwise
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
              ? "concave-sel text-text-primary"
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
                // resetKey bumps ONLY on explicit reloads ("Discard
                // mine", at-rest server pulls). Save success must never
                // re-seed the editor — the server snapshot is older than
                // whatever the user typed while the PUT was in flight,
                // and reseeding would clobber those keystrokes.
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
