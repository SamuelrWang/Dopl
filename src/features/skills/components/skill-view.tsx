"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, Download, Folder, History } from "lucide-react";
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
import {
  DocEditor,
  SaveStatusIndicator,
  type SaveStatus,
} from "@/shared/editor/doc-editor";
import {
  type ResolvedSkill,
  type Skill,
  type SkillFile,
} from "@/features/skills/types";
import {
  SkillApiError,
  type UpdateSkillPatch,
  duplicateSkill,
  fetchSkill,
  readSkillBody,
  updateSkill,
  writeSkillBody,
} from "@/features/skills/client/api";
import { useSkillsRealtime } from "../client/realtime";
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
   * Something that changes the PARENT's list rendering landed (rename,
   * refolder, duplicate). Injected instead of calling a router directly so
   * this component stays Next-free: the web app passes `router.refresh()`,
   * the desktop SPA passes a TanStack `invalidateQueries` — neither concept
   * exists in both apps (apps/desktop-ui/CONVENTIONS.md).
   */
  onListChanged?: () => void;
}

const AUTOSAVE_DELAY_MS = 1500;

/**
 * The skill editor pane — rendered inline in the skills browser's
 * detail pane (no separate route).
 *
 * Skills are single-file: this is a single-document editor for the one
 * SKILL.md. Layout: title/share/save header, then the DocEditor for the
 * body. Body edits autosave after 1.5s of inactivity, with the same
 * optimistic-concurrency (412) conflict flow the KB editor uses. Parent
 * must key this component by skill id so switching skills remounts fresh
 * state.
 */
export function SkillView({
  resolved,
  workspaceSlug,
  workspaceId,
  isAdmin,
  currentUserId,
  onDuplicated,
  onListChanged,
}: Props) {
  const { skill } = resolved;

  // Inline-editable display name + sharing. Mirror the props until the
  // user commits a change, then drive from local state so the bar
  // updates immediately without a route reload.
  const [displayedName, setDisplayedName] = useState(skill.name);
  const [displayedFolder, setDisplayedFolder] = useState(skill.folder);
  const [displayedSharing, setDisplayedSharing] = useState({
    visibility: skill.visibility,
    accessMode: skill.accessMode,
    grantedTeamIds: skill.grantedTeamIds,
  });
  // Re-sync the mirrors when the server prop changes (sanctioned
  // adjust-state-during-render pattern — no effect round-trip).
  const sharingKey = `${skill.visibility}:${skill.accessMode}:${skill.grantedTeamIds.join(",")}`;
  const [lastSkillProps, setLastSkillProps] = useState({
    name: skill.name,
    folder: skill.folder,
    sharingKey,
  });
  if (
    lastSkillProps.name !== skill.name ||
    lastSkillProps.folder !== skill.folder ||
    lastSkillProps.sharingKey !== sharingKey
  ) {
    setLastSkillProps({ name: skill.name, folder: skill.folder, sharingKey });
    setDisplayedName(skill.name);
    setDisplayedFolder(skill.folder);
    setDisplayedSharing({
      visibility: skill.visibility,
      accessMode: skill.accessMode,
      grantedTeamIds: skill.grantedTeamIds,
    });
  }

  // Audit A-005 / A-013: gate write affordances on the caller's
  // effective access. Falls open to true while access is loading.
  const access = useMyAccessContext();
  const accessLevel = access.resolve("skill", skill.id);
  const canEdit = accessLevel == null ? true : meetsLevel(accessLevel, "edit");

  const initialFile = useMemo(() => primaryFile(resolved.files), [resolved.files]);
  const [file, setFile] = useState<SkillFile>(initialFile);
  // Markdown seed handed to DocEditor + explicit reload key. The editor
  // owns its content while typing; we re-seed ONLY on user-driven reload
  // ("Discard mine") or an at-rest server pull — never on save success,
  // which would clobber keystrokes typed while the PUT was in flight.
  const [editorMd, setEditorMd] = useState(initialFile.body);
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  // Bumped whenever a save lands so the open history panel refetches.
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  // 412 surfaced from the autosave path. While set, the editor shows a
  // banner with explicit Save mine / Discard mine buttons; debounced
  // autosave is paused.
  const [conflict, setConflict] = useState<{
    serverBody: string;
    serverUpdatedAt: string;
  } | null>(null);

  // Debounce timer + pending-body cache. Held in refs so the unmount
  // cleanup can flush the in-flight edit without stale React state.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBodyRef = useRef<string | null>(null);
  // Baseline `updatedAt` for the optimistic-concurrency precondition;
  // updated on every successful save.
  const baselineRef = useRef(initialFile.updatedAt);
  // Metadata-CAS baseline — the skill row's `updated_at`, a SEPARATE clock
  // from the body's `body_updated_at` (baselineRef). Both metadata PATCHes
  // AND body saves move it (the touch trigger fires on any skills UPDATE), so
  // it's refreshed from every response that carries it: metadata PATCHes, body
  // saves (skillUpdatedAt), and full skill pulls. Keeping it current is what
  // stops a name/folder/sharing edit from false-412-ing right after a body
  // autosave (F-038 D9/D10).
  const metaBaselineRef = useRef(skill.updatedAt);
  const slugRef = useRef(skill.slug);
  useEffect(() => {
    slugRef.current = skill.slug;
  }, [skill.slug]);
  // Mirrors for event handlers / unmount cleanup. Written in an effect
  // (not during render) per react-hooks/refs; consumers only read them
  // asynchronously, so post-render timing is equivalent.
  const conflictRef = useRef<typeof conflict>(null);
  const saveStatusRef = useRef<SaveStatus>(saveStatus);
  useEffect(() => {
    conflictRef.current = conflict;
    saveStatusRef.current = saveStatus;
  }, [conflict, saveStatus]);

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

  // Serialize every body PUT through one chain so two saves can never be
  // in flight together. An overlapping save would carry a stale baseline
  // and 412 against our own write — the "someone else is editing" banner
  // with only one editor in the room.
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueSave = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = saveChainRef.current.then(job, job);
    // Park a swallowed tail so an unawaited failing job can't surface as
    // an unhandled rejection; callers that await `next` still see it.
    saveChainRef.current = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }, []);

  const flushSave = useCallback(
    () =>
      enqueueSave(async () => {
        // Don't fire while in conflict — autosave would just 412 again.
        if (conflictRef.current) return;
        const body = pendingBodyRef.current;
        if (body === null) return;
        pendingBodyRef.current = null;
        setSaveStatus("saving");
        try {
          const { file: updated, skillUpdatedAt } = await writeSkillBody(
            slugRef.current,
            body,
            workspaceId,
            baselineRef.current
          );
          baselineRef.current = updated.updatedAt;
          // The body write bumped the row's updated_at; keep the metadata
          // precondition current so a following name/folder/sharing edit
          // doesn't false-412 (F-038 D10).
          metaBaselineRef.current = skillUpdatedAt;
          setFile(updated);
          setHistoryRefreshKey((k) => k + 1);
          setSaveStatus("saved");
          setTimeout(() => {
            setSaveStatus((prev) => (prev === "saved" ? "idle" : prev));
          }, 1800);
        } catch (err) {
          if (err instanceof SkillApiError && err.status === 412) {
            // Pull the server's current state so the user can decide
            // (Save mine / Discard mine). Re-buffer the losing body ONLY
            // if nothing newer was typed while the PUT was in flight —
            // never stomp fresher keystrokes with an older snapshot.
            if (pendingBodyRef.current === null) pendingBodyRef.current = body;
            try {
              const fresh = await readSkillBody(slugRef.current, workspaceId);
              baselineRef.current = fresh.updatedAt;
              setConflict({
                serverBody: fresh.body,
                serverUpdatedAt: fresh.updatedAt,
              });
            } catch {
              toast({
                title: "Edited elsewhere",
                description:
                  "Couldn't load the latest server version — please refresh.",
              });
            }
            setSaveStatus("error");
            return;
          }
          setSaveStatus("error");
          toast({ title: "Couldn't save", description: errMessage(err) });
        }
      }),
    [enqueueSave, workspaceId]
  );

  const scheduleSave = useCallback(
    (body: string) => {
      pendingBodyRef.current = body;
      setSaveStatus("dirty");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flushSave();
      }, AUTOSAVE_DELAY_MS);
    },
    [flushSave]
  );

  // Cleanup any pending timer on unmount, then flush the last edit
  // through the save chain (so it runs AFTER any in-flight save and
  // carries a fresh baseline). A 412 here has no editor left to show a
  // banner in — surface a toast instead of dropping silently. Skipped
  // mid-conflict.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (conflictRef.current) return;
      if (pendingBodyRef.current === null) return;
      void enqueueSave(async () => {
        const body = pendingBodyRef.current;
        if (body === null) return;
        pendingBodyRef.current = null;
        try {
          await writeSkillBody(slugRef.current, body, workspaceId, baselineRef.current);
        } catch (err) {
          if (err instanceof SkillApiError && err.status === 412) {
            toast({
              title: "Last edit not saved",
              description:
                "This skill was edited elsewhere while you navigated away — reopen it to reconcile.",
            });
          }
        }
      });
    };
  }, [enqueueSave, workspaceId]);

  // Conflict resolution: keep the user's local edits, force-save over
  // the server using the latest known precondition. Another racing
  // writer re-triggers the conflict — never silently overwrite.
  const handleKeepMine = useCallback(() => enqueueSave(async () => {
    const c = conflictRef.current;
    if (!c) return;
    const body = pendingBodyRef.current;
    if (body === null) return;
    setSaveStatus("saving");
    try {
      const { file: saved, skillUpdatedAt } = await writeSkillBody(
        slugRef.current,
        body,
        workspaceId,
        c.serverUpdatedAt
      );
      baselineRef.current = saved.updatedAt;
      metaBaselineRef.current = skillUpdatedAt;
      setFile(saved);
      pendingBodyRef.current = null;
      setConflict(null);
      setSaveStatus("saved");
      setTimeout(() => {
        setSaveStatus((prev) => (prev === "saved" ? "idle" : prev));
      }, 1800);
    } catch (err) {
      if (err instanceof SkillApiError && err.status === 412) {
        try {
          const fresh = await readSkillBody(slugRef.current, workspaceId);
          baselineRef.current = fresh.updatedAt;
          setConflict({
            serverBody: fresh.body,
            serverUpdatedAt: fresh.updatedAt,
          });
        } catch {
          // Network blip — leave the existing conflict snapshot; retry.
        }
        setSaveStatus("error");
        return;
      }
      setSaveStatus("error");
      toast({ title: "Couldn't save", description: errMessage(err) });
    }
  }), [enqueueSave, workspaceId]);

  // Push a server body into the editor: re-seed the Tiptap state via the
  // explicit reload key. Callers own the safety check (user chose to
  // discard, or the editor is at rest).
  const reloadEditor = useCallback((body: string) => {
    setEditorMd(body);
    setEditorReloadKey((k) => k + 1);
  }, []);

  // Conflict resolution: discard local typing, reload the server body.
  const handleDiscardMine = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    pendingBodyRef.current = null;
    baselineRef.current = c.serverUpdatedAt;
    setFile((prev) => ({
      ...prev,
      body: c.serverBody,
      updatedAt: c.serverUpdatedAt,
    }));
    reloadEditor(c.serverBody);
    setConflict(null);
    setSaveStatus("idle");
  }, [reloadEditor]);

  // Pull the freshest skill + body from the server and replace local
  // state, including the editor seed. Callers MUST ensure the editor is
  // at rest first — a reload replaces the Tiptap content, so a mid-edit
  // pull would yank the document out from under the user.
  const pullFreshSkill = useCallback(async () => {
    const fresh = await fetchSkill(slugRef.current, workspaceId).catch(() => null);
    if (!fresh) return;
    const next = primaryFile(fresh.files);
    baselineRef.current = next.updatedAt;
    metaBaselineRef.current = fresh.skill.updatedAt;
    setFile(next);
    reloadEditor(next.body);
    // Remote metadata edits (rename / refolder / reshare from another tab or
    // an MCP agent) surface here too — sync the displayed bar and its baseline.
    setDisplayedName(fresh.skill.name);
    setDisplayedFolder(fresh.skill.folder);
    setDisplayedSharing({
      visibility: fresh.skill.visibility,
      accessMode: fresh.skill.accessMode,
      grantedTeamIds: fresh.skill.grantedTeamIds,
    });
  }, [reloadEditor, workspaceId]);

  // Metadata-only refresh (no editor reseed) — safe to call while the body
  // editor is mid-edit. Used on a metadata 412 to show the server's current
  // name/folder/sharing and refresh the metadata precondition.
  const refreshMeta = useCallback(async () => {
    const fresh = await fetchSkill(slugRef.current, workspaceId).catch(() => null);
    if (!fresh) return;
    metaBaselineRef.current = fresh.skill.updatedAt;
    setDisplayedName(fresh.skill.name);
    setDisplayedFolder(fresh.skill.folder);
    setDisplayedSharing({
      visibility: fresh.skill.visibility,
      accessMode: fresh.skill.accessMode,
      grantedTeamIds: fresh.skill.grantedTeamIds,
    });
  }, [workspaceId]);

  // Single choke-point for metadata (name / folder / sharing) PATCHes: sends
  // the metadata precondition and, on a 412, refreshes the bar + baseline and
  // surfaces the conflict as a toast (the discrete-field analogue of the body
  // editor's "Edited elsewhere" banner) rather than silently overwriting.
  const commitMeta = useCallback(
    async (patch: UpdateSkillPatch): Promise<Skill | null> => {
      try {
        const saved = await updateSkill(
          slugRef.current,
          patch,
          workspaceId,
          metaBaselineRef.current
        );
        metaBaselineRef.current = saved.updatedAt;
        return saved;
      } catch (err) {
        if (err instanceof SkillApiError && err.status === 412) {
          await refreshMeta();
          toast({
            title: "Edited elsewhere",
            description:
              "This skill's details changed elsewhere — your edit wasn't applied. The latest is shown; reapply if you still want it.",
          });
          return null;
        }
        throw err;
      }
    },
    [workspaceId, refreshMeta]
  );

  const isEditorAtRest = useCallback(
    () =>
      timerRef.current === null &&
      pendingBodyRef.current === null &&
      saveStatusRef.current !== "saving" &&
      conflictRef.current === null,
    []
  );

  // When the user switches back to this tab AND nothing is mid-save,
  // pull the freshest version so changes another tab or an MCP agent
  // saved while away show up automatically.
  useRefetchOnFocus(pullFreshSkill, {
    skip: () => timerRef.current !== null || pendingBodyRef.current !== null,
  });

  // Live updates (Tier 2): another user / MCP agent saving the body or
  // skill metadata, or writing a version, pushes here. Bump the history
  // key first (independent of the editor — the open version rail refetches
  // whether or not the editor is mid-edit), then pull the freshest body
  // only when the editor is fully at rest so a remote change never
  // remounts the active editor.
  const onRealtimeChange = useCallback(() => {
    setHistoryRefreshKey((k) => k + 1);
    if (!isEditorAtRest()) return;
    void pullFreshSkill();
  }, [isEditorAtRest, pullFreshSkill]);
  useSkillsRealtime(skill.workspaceId, onRealtimeChange);

  const updateBody = useCallback(
    (body: string) => {
      setFile((prev) => ({ ...prev, body }));
      scheduleSave(body);
    },
    [scheduleSave]
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col antialiased">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <EditableTitle
            value={displayedName}
            onSave={async (next) => {
              const saved = await commitMeta({ name: next });
              if (!saved) return; // 412 — commitMeta refreshed + toasted.
              setDisplayedName(saved.name);
              // The browser's list pane renders server-fetched names —
              // refresh so the row matches the new title.
              onListChanged?.();
            }}
            onError={(err) =>
              toast({ title: "Couldn't rename", description: errMessage(err) })
            }
            placeholder="Untitled skill"
          />
          <FolderControl
            folder={displayedFolder}
            canEdit={canEdit}
            onSave={async (next) => {
              try {
                const saved = await commitMeta({ folder: next });
                if (!saved) return; // 412 — commitMeta refreshed + toasted.
                setDisplayedFolder(saved.folder);
                // Left list groups by folder — refresh so the row re-homes.
                onListChanged?.();
              } catch (err) {
                toast({
                  title: "Couldn't change folder",
                  description: errMessage(err),
                });
              }
            }}
          />
          <SkillShareControl
            skill={{ ...skill, ...displayedSharing }}
            workspaceSlug={workspaceSlug}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            onShareChange={async (scope, teamIds) => {
              try {
                const saved = await commitMeta(
                  scope === "private"
                    ? { visibility: "private" }
                    : scope === "team"
                      ? { visibility: "public", accessMode: "teams", teamIds }
                      : { visibility: "public", accessMode: "workspace" }
                );
                if (!saved) return; // 412 — commitMeta refreshed + toasted.
                setDisplayedSharing({
                  visibility: saved.visibility,
                  accessMode: saved.accessMode,
                  grantedTeamIds: saved.grantedTeamIds,
                });
              } catch (err) {
                toast({
                  title: "Couldn't change sharing",
                  description: errMessage(err),
                });
              }
            }}
          />
        </div>
        <AvatarStack users={otherEditors} />
        <SaveStatusIndicator state={saveStatus} />
        <HeaderActions
          slug={skill.slug}
          workspaceId={workspaceId}
          canEdit={canEdit}
          onDuplicated={onDuplicated}
          onListChanged={onListChanged}
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
                    onClick={handleKeepMine}
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
                if (isEditorAtRest()) void pullFreshSkill();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Folder control (inline assign / rename) ─────────────────────────

function FolderControl({
  folder,
  canEdit,
  onSave,
}: {
  folder: string | null;
  canEdit: boolean;
  onSave: (next: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder ?? "");
  // Re-sync the draft when the committed folder changes (sanctioned
  // adjust-state-during-render pattern — no effect round-trip).
  const [lastFolder, setLastFolder] = useState(folder);
  if (lastFolder !== folder) {
    setLastFolder(folder);
    setDraft(folder ?? "");
  }

  const commit = () => {
    setEditing(false);
    const next = draft.trim() === "" ? null : draft.trim();
    if (next !== (folder ?? null)) void onSave(next);
  };

  if (!canEdit) {
    if (!folder) return null;
    return (
      <span className="flex shrink-0 items-center gap-1 text-caption text-text-muted">
        <Folder size={11} />
        {folder}
      </span>
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(folder ?? "");
            setEditing(false);
          }
        }}
        placeholder="Folder"
        aria-label="Skill folder"
        className="concave-field h-6 w-32 rounded-md px-2 text-caption text-text-primary"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={folder ? `Folder: ${folder}` : "Add to a folder"}
      className="btn-light flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-caption text-text-secondary"
    >
      <Folder size={11} />
      {folder ?? "Add folder"}
    </button>
  );
}

// ── Header actions (duplicate / export) ─────────────────────────────

function HeaderActions({
  slug,
  workspaceId,
  canEdit,
  onDuplicated,
  onListChanged,
}: {
  slug: string;
  workspaceId: string;
  canEdit: boolean;
  onDuplicated?: (skill: Skill) => void;
  onListChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <a
        // A plain download link can't send X-Workspace-Id, so scope the export
        // to the active workspace with the `?workspaceId=` query param the
        // route accepts (membership-checked server-side).
        href={`/api/skills/${encodeURIComponent(slug)}/export?workspaceId=${encodeURIComponent(workspaceId)}`}
        download
        title="Download as a Claude-Code-compatible skill zip"
        className="btn-light flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary"
      >
        <Download size={12} />
        Export
      </a>
      {canEdit && (
        <button
          type="button"
          disabled={busy}
          title="Fork into a new private draft"
          onClick={async () => {
            setBusy(true);
            try {
              const created = await duplicateSkill(slug, workspaceId);
              toast({ title: "Skill duplicated", description: created.skill.name });
              onDuplicated?.(created.skill);
              onListChanged?.();
              setBusy(false);
            } catch (err) {
              toast({ title: "Couldn't duplicate", description: errMessage(err) });
              setBusy(false);
            }
          }}
          className="btn-light flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary disabled:opacity-50"
        >
          <Copy size={12} />
          {busy ? "Duplicating…" : "Duplicate"}
        </button>
      )}
    </>
  );
}
