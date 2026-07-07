"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  Download,
  History,
  Layers,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/utils";
import { EditableTitle } from "@/shared/layout/editable-title";
import { VisibilityPill, MakePublicAction } from "@/shared/ui/visibility-pill";
import { useMyAccessContext } from "@/features/members/hooks/use-my-access";
import { meetsLevel } from "@/features/teams/access-levels";
import { useRefetchOnFocus } from "@/shared/hooks/use-refetch-on-focus";
import { useCurrentProfile } from "@/shared/auth/use-current-profile";
import { usePresence } from "@/shared/realtime/use-presence";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { toast } from "@/shared/ui/toast";
import { AlertTriangle } from "lucide-react";
// Cross-feature imports: DocEditor + SourceIcon live in features/knowledge
// today. They're generic enough to belong in shared/ — moving is a future
// refactor (per ENGINEERING.md §3 / §16). Keeping the imports as-is for
// now matches the existing SourceIcon precedent in this file.
import {
  DocEditor,
  SaveStatusIndicator,
  type SaveStatus,
} from "@/shared/editor/doc-editor";
import { SourceIcon } from "@/shared/ui/source-icon";
import type { SourceProvider } from "@/shared/lib/source-types";
import {
  PRIMARY_SKILL_FILE_NAME,
  type ResolvedSkill,
  type Skill,
  type SkillFile,
  type SkillUsage,
  type SkillUsedBy,
  type WorkspaceKbSummary,
} from "@/features/skills/types";
import { parseSkillBody } from "@/features/skills/skill-body";
import { lintSkill, type SkillLintIssue } from "@/features/skills/skill-lint";
import {
  SkillApiError,
  createSkillFile,
  deleteSkillFile,
  duplicateSkill,
  fetchSkill,
  readSkillFile,
  renameSkillFile,
  updateSkill,
  writeSkillFile,
} from "@/features/skills/client/api";
import { useSkillsRealtime } from "../client/realtime";
import { FileTabs } from "./skill-file-tabs";
import { SkillHistoryPanel } from "./skill-history-panel";
import {
  errMessage,
  escapeRegExp,
  primaryFileId,
  renameErrDescription,
  sortFiles,
} from "./skill-view-utils";

interface Props {
  resolved: ResolvedSkill;
  workspaceKbs: WorkspaceKbSummary[];
  workspaceSlug: string;
  /** Clusters + workflows this skill is attached to (server-fetched). */
  usedBy: SkillUsedBy;
  /** Agent read activity (server-fetched from mcp_events). */
  usage: SkillUsage;
  /** True if the current user is the skill's owner — gates the inline
   *  "Make public" button next to the visibility pill. */
  isOwner: boolean;
}

const KNOWN_PROVIDERS = new Set<SourceProvider>([
  "slack",
  "google-drive",
  "gmail",
  "notion",
  "github",
]);

const AUTOSAVE_DELAY_MS = 1500;

/**
 * Skill detail page — single chat-shell-style panel.
 *
 * Layout: file tabs across the top, DocEditor for the active file,
 * right rail with workspace KB picker + connectors strip. Dropping
 * a tab, renaming, or adding a file all hit the API; body edits
 * autosave per file.
 *
 * State model: `files` mirrors the server, updated optimistically on
 * each successful save / create / rename / delete. The body the editor
 * shows lives in this mirror, so KB-toggle insertions and user typing
 * are immediately visible. Per-file debounce timers fire a PUT after
 * 1.5s of inactivity.
 */
export function SkillView({
  resolved,
  workspaceKbs,
  workspaceSlug,
  usedBy,
  usage,
  isOwner,
}: Props) {
  const { skill } = resolved;

  // Inline-editable display name. Mirror the prop until the user
  // commits a rename, then drive from local state so the bar updates
  // immediately without a route reload.
  const [displayedName, setDisplayedName] = useState(skill.name);
  const [displayedVisibility, setDisplayedVisibility] = useState(
    skill.visibility
  );
  // Re-sync the mirrors when the server prop changes (sanctioned
  // adjust-state-during-render pattern — no effect round-trip).
  const [lastSkillProps, setLastSkillProps] = useState({
    name: skill.name,
    visibility: skill.visibility,
  });
  if (
    lastSkillProps.name !== skill.name ||
    lastSkillProps.visibility !== skill.visibility
  ) {
    setLastSkillProps({ name: skill.name, visibility: skill.visibility });
    setDisplayedName(skill.name);
    setDisplayedVisibility(skill.visibility);
  }

  // Audit A-005 / A-013: gate write affordances on the caller's
  // effective access. Falls open to true while access is loading.
  const access = useMyAccessContext();
  const accessLevel = access.resolve("skill", skill.id);
  const canEdit = accessLevel == null ? true : meetsLevel(accessLevel, "edit");

  const [files, setFiles] = useState<SkillFile[]>(() =>
    sortFiles(resolved.files)
  );
  const [activeFileId, setActiveFileId] = useState<string>(
    () => primaryFileId(resolved.files) ?? resolved.files[0]?.id ?? ""
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  // Bumped whenever a save lands so the open history panel refetches.
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  // 412 surfaced from the autosave path. While set, the conflicting
  // file's editor shows a banner with explicit Save mine / Discard
  // mine buttons; debounced autosave is paused for that file.
  const [conflict, setConflict] = useState<{
    fileId: string;
    fileName: string;
    serverBody: string;
    serverUpdatedAt: string;
  } | null>(null);

  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId) ?? files[0],
    [files, activeFileId]
  );

  // Per-file debounce timers and pending-body cache. Pending bodies are
  // held in a ref so the unmount cleanup can flush in-flight edits
  // without going through stale React state.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const pendingBodiesRef = useRef<Map<string, string>>(new Map());
  // Filename + baseline updatedAt tracked per file so the unmount-flush
  // can use the freshest precondition without going through React
  // state. Updated on every successful save.
  const fileMetaRef = useRef<
    Map<string, { name: string; updatedAt: string }>
  >(new Map());
  useEffect(() => {
    for (const f of files) {
      fileMetaRef.current.set(f.id, { name: f.name, updatedAt: f.updatedAt });
    }
  }, [files]);
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

  const flushSave = useCallback(
    async (fileId: string, fileName: string, body: string) => {
      // Don't fire while this exact file is in conflict — autosave
      // would just 412 again.
      if (conflictRef.current && conflictRef.current.fileId === fileId) {
        return;
      }
      pendingBodiesRef.current.delete(fileId);
      const baseline = fileMetaRef.current.get(fileId)?.updatedAt;
      setSaveStatus("saving");
      try {
        const updated = await writeSkillFile(
          slugRef.current,
          fileName,
          body,
          undefined,
          baseline
        );
        fileMetaRef.current.set(updated.id, {
          name: updated.name,
          updatedAt: updated.updatedAt,
        });
        setFiles((prev) =>
          prev.map((f) => (f.id === fileId ? updated : f))
        );
        setHistoryRefreshKey((k) => k + 1);
        setSaveStatus("saved");
        setTimeout(() => {
          setSaveStatus((prev) => (prev === "saved" ? "idle" : prev));
        }, 1800);
      } catch (err) {
        if (err instanceof SkillApiError && err.status === 412) {
          // Pull the server's current state so the user can decide
          // (Save mine / Discard mine). Re-buffer their typing for
          // the "Save mine" path.
          pendingBodiesRef.current.set(fileId, body);
          try {
            const fresh = await readSkillFile(
              slugRef.current,
              fileName
            );
            fileMetaRef.current.set(fresh.id, {
              name: fresh.name,
              updatedAt: fresh.updatedAt,
            });
            setConflict({
              fileId,
              fileName,
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
    },
    []
  );

  const scheduleSave = useCallback(
    (fileId: string, fileName: string, body: string) => {
      pendingBodiesRef.current.set(fileId, body);
      setSaveStatus("dirty");
      const existing = timersRef.current.get(fileId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timersRef.current.delete(fileId);
        const latest = pendingBodiesRef.current.get(fileId);
        if (latest === undefined) return;
        void flushSave(fileId, fileName, latest);
      }, AUTOSAVE_DELAY_MS);
      timersRef.current.set(fileId, timer);
    },
    [flushSave]
  );

  // Cleanup any pending timers on unmount. Fire-and-forget the final
  // PUTs so an entry-switch or page nav doesn't drop the last 1.5s of
  // typing. Each PUT carries the file's baseline updatedAt so a
  // racing concurrent writer 412s us instead of getting silently
  // overwritten — same precondition the live autosave uses. The
  // dropped 412s end up in the dev console only (the component is
  // unmounting, no UI to surface a banner into).
  useEffect(() => {
    const timers = timersRef.current;
    const pending = pendingBodiesRef.current;
    const meta = fileMetaRef.current;
    return () => {
      const slug = slugRef.current;
      const conflictedId = conflictRef.current?.fileId;
      for (const [fileId, timer] of timers) {
        clearTimeout(timer);
        // Skip files that are mid-conflict — silent unmount-saves
        // while the user was about to choose would overwrite their
        // resolution intent.
        if (fileId === conflictedId) continue;
        const body = pending.get(fileId);
        const m = meta.get(fileId);
        if (body !== undefined && m) {
          writeSkillFile(slug, m.name, body, undefined, m.updatedAt).catch(
            (err: unknown) => {
              if (err instanceof SkillApiError && err.status === 412) {
                console.warn(
                  "[skills] unmount autosave dropped (412 stale)",
                  { slug, file: m.name }
                );
              }
            }
          );
        }
      }
      timers.clear();
      pending.clear();
    };
  }, []);

  // Conflict resolution: keep the user's local edits, force-save over
  // the server using the latest known precondition. If yet another
  // writer slipped in between fetch and PATCH, we 412 again and refresh
  // the conflict — never silently overwrite an unseen newer version.
  const handleKeepMine = useCallback(async () => {
    const c = conflictRef.current;
    if (!c) return;
    const body = pendingBodiesRef.current.get(c.fileId);
    if (body === undefined) return;
    setSaveStatus("saving");
    try {
      const saved = await writeSkillFile(
        slugRef.current,
        c.fileName,
        body,
        undefined,
        c.serverUpdatedAt
      );
      fileMetaRef.current.set(saved.id, {
        name: saved.name,
        updatedAt: saved.updatedAt,
      });
      setFiles((prev) => prev.map((f) => (f.id === saved.id ? saved : f)));
      pendingBodiesRef.current.delete(c.fileId);
      setConflict(null);
      setSaveStatus("saved");
      setTimeout(() => {
        setSaveStatus((prev) => (prev === "saved" ? "idle" : prev));
      }, 1800);
    } catch (err) {
      if (err instanceof SkillApiError && err.status === 412) {
        try {
          const fresh = await readSkillFile(slugRef.current, c.fileName);
          fileMetaRef.current.set(fresh.id, {
            name: fresh.name,
            updatedAt: fresh.updatedAt,
          });
          setConflict({
            fileId: c.fileId,
            fileName: c.fileName,
            serverBody: fresh.body,
            serverUpdatedAt: fresh.updatedAt,
          });
        } catch {
          // Network blip — leave the existing conflict snapshot in
          // place; user can retry.
        }
        setSaveStatus("error");
        return;
      }
      setSaveStatus("error");
      toast({ title: "Couldn't save", description: errMessage(err) });
    }
  }, []);

  // Conflict resolution: discard the user's local typing, reload the
  // server's content into the editor.
  const handleDiscardMine = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    pendingBodiesRef.current.delete(c.fileId);
    fileMetaRef.current.set(c.fileId, {
      name: c.fileName,
      updatedAt: c.serverUpdatedAt,
    });
    setFiles((prev) =>
      prev.map((f) =>
        f.id === c.fileId
          ? { ...f, body: c.serverBody, updatedAt: c.serverUpdatedAt }
          : f
      )
    );
    setConflict(null);
    setSaveStatus("idle");
  }, []);

  // Pull the freshest skill + files from the server and replace local
  // state. Callers MUST ensure the editor is at rest first (see the
  // guards below) — a replace bumps the active file's `updatedAt`, which
  // is part of the editor's resetKey, so calling this mid-edit would
  // remount the editor under the user.
  const pullFreshSkill = useCallback(async () => {
    const fresh = await fetchSkill(slugRef.current).catch(() => null);
    if (!fresh) return;
    setFiles(sortFiles(fresh.files));
    // If the active tab still exists in the new payload, keep it;
    // otherwise fall back to SKILL.md (or the first file).
    setActiveFileId((prev) => {
      if (fresh.files.some((f) => f.id === prev)) return prev;
      return primaryFileId(fresh.files) ?? fresh.files[0]?.id ?? prev;
    });
  }, []);

  const isEditorAtRest = useCallback(
    () =>
      timersRef.current.size === 0 &&
      pendingBodiesRef.current.size === 0 &&
      saveStatusRef.current !== "saving" &&
      conflictRef.current === null,
    []
  );

  // When the user switches back to this tab AND nothing is mid-save,
  // pull the freshest version of the skill so changes another tab or
  // an MCP agent saved while away show up automatically.
  useRefetchOnFocus(pullFreshSkill, {
    skip: () =>
      timersRef.current.size > 0 || pendingBodiesRef.current.size > 0,
  });

  // Live updates (Tier 2): another user / MCP agent saving a file or skill
  // metadata pushes here. Only pull when the editor is fully at rest so a
  // remote change to ANY file never remounts the active editor under the
  // user. While they're editing, the refetch is skipped and self-heals on
  // the next event once they pause (their own save echoes a realtime event).
  const onRealtimeChange = useCallback(() => {
    if (!isEditorAtRest()) return;
    void pullFreshSkill();
  }, [isEditorAtRest, pullFreshSkill]);
  useSkillsRealtime(skill.workspaceId, onRealtimeChange);

  const updateActiveBody = useCallback(
    (body: string) => {
      if (!activeFile) return;
      setFiles((prev) =>
        prev.map((f) => (f.id === activeFile.id ? { ...f, body } : f))
      );
      // fileMetaRef (above) is the canonical filename + updatedAt
      // source for the unmount-flush — no parallel pending-name
      // tracking needed.
      scheduleSave(activeFile.id, activeFile.name, body);
    },
    [activeFile, scheduleSave]
  );

  const handleAddFile = useCallback(async () => {
    const existing = new Set(files.map((f) => f.name));
    let i = 1;
    let name = `untitled-${i}.md`;
    while (existing.has(name)) {
      i += 1;
      name = `untitled-${i}.md`;
    }
    try {
      const file = await createSkillFile(skill.slug, { name });
      setFiles((prev) => sortFiles([...prev, file]));
      setActiveFileId(file.id);
    } catch (err) {
      toast({ title: "Couldn't create file", description: errMessage(err) });
    }
  }, [files, skill.slug]);

  const handleRemoveFile = useCallback(
    async (file: SkillFile) => {
      if (file.name === PRIMARY_SKILL_FILE_NAME) {
        toast({
          title: "SKILL.md can't be deleted",
          description: "Every skill needs a primary file.",
        });
        return;
      }
      try {
        await deleteSkillFile(skill.slug, file.name);
        setFiles((prev) => prev.filter((f) => f.id !== file.id));
        if (activeFileId === file.id) {
          const next =
            files.find(
              (f) => f.name === PRIMARY_SKILL_FILE_NAME && f.id !== file.id
            ) ?? files.find((f) => f.id !== file.id);
          if (next) setActiveFileId(next.id);
        }
      } catch (err) {
        toast({ title: "Couldn't delete file", description: errMessage(err) });
      }
    },
    [activeFileId, files, skill.slug]
  );

  const handleRenameFile = useCallback(
    async (file: SkillFile, newName: string) => {
      if (file.name === PRIMARY_SKILL_FILE_NAME) return;
      const cleaned = newName.trim();
      if (!cleaned || cleaned === file.name) return;
      try {
        const renamed = await renameSkillFile(skill.slug, file.name, cleaned);
        setFiles((prev) =>
          prev.map((f) => (f.id === file.id ? renamed : f))
        );
      } catch (err) {
        // Echo to the dev console so the actual server message is
        // recoverable from DevTools when the user reports a failure.
        console.error("[skills] rename failed", { file: file.name, target: cleaned, err });
        toast({
          title: "Couldn't rename file",
          description: renameErrDescription(err, file.name, cleaned),
        });
      }
    },
    [skill.slug]
  );

  // KB references parsed from every file's current body — drives the
  // right-rail checkbox state.
  const referencedKbSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const file of files) {
      const refs = parseSkillBody(file.body).references;
      for (const ref of refs) {
        if (ref.kind === "kb") set.add(ref.slug);
      }
    }
    return set;
  }, [files]);

  const lintIssues = useMemo(
    () => lintSkill({ ...resolved, skill, files }),
    [resolved, skill, files]
  );

  const toggleKb = useCallback(
    (kb: WorkspaceKbSummary) => {
      if (!activeFile) return;
      const linked = referencedKbSlugs.has(kb.slug);
      const current = activeFile.body;
      if (linked) {
        const re = new RegExp(
          `\\[[^\\]]+\\]\\(dopl://kb/${escapeRegExp(kb.slug)}\\)`,
          "g"
        );
        updateActiveBody(current.replace(re, kb.name));
      } else {
        const insert = `[${kb.name}](dopl://kb/${kb.slug})`;
        const next = current.trim()
          ? `${current.replace(/\s*$/, "")}\n\n${insert}\n`
          : `${insert}\n`;
        updateActiveBody(next);
      }
    },
    [activeFile, referencedKbSlugs, updateActiveBody]
  );

  return (
    <div className="page-float flex flex-col antialiased">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
            <EditableTitle
              value={displayedName}
              onSave={async (next) => {
                const saved = await updateSkill(skill.slug, { name: next });
                setDisplayedName(saved.name);
              }}
              onError={(err) =>
                toast({ title: "Couldn't rename", description: errMessage(err) })
              }
              placeholder="Untitled skill"
            />
            <VisibilityPill visibility={displayedVisibility} />
            {displayedVisibility === "private" && isOwner ? (
              <MakePublicAction
                resourceType="skill"
                onConfirm={async () => {
                  try {
                    await updateSkill(skill.slug, { visibility: "public" });
                    setDisplayedVisibility("public");
                    toast({ title: "Skill is now public" });
                  } catch (err) {
                    toast({
                      title: "Couldn't publish",
                      description: errMessage(err),
                    });
                  }
                }}
              />
            ) : null}
        </div>
        <AvatarStack users={otherEditors} />
        <SaveStatusIndicator state={saveStatus} />
        <HeaderActions
          slug={skill.slug}
          workspaceSlug={workspaceSlug}
          canEdit={canEdit}
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
            <FileTabs
              files={files}
              activeId={activeFile?.id ?? ""}
              canEdit={canEdit}
              onSelect={setActiveFileId}
              onAdd={handleAddFile}
              onRemove={handleRemoveFile}
              onRename={handleRenameFile}
            />
            <div className="flex-1 min-h-0 overflow-y-auto">
              {activeFile && conflict && conflict.fileId === activeFile.id && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-2 border-b border-warning/25 bg-warning/5 px-4 py-2 text-small leading-relaxed text-text-primary"
                >
                  <AlertTriangle size={13} className="shrink-0 text-warning" />
                  <span className="min-w-0 flex-1">
                    <strong className="font-semibold">
                      Edited elsewhere.
                    </strong>{" "}
                    The server has a newer version of this file — your edits
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
                    {saveStatus === "saving"
                      ? "Saving…"
                      : "Save mine, overwrite"}
                  </button>
                </div>
              )}
              {activeFile && (
                <DocEditor
                  key={activeFile.id}
                  initialMarkdown={activeFile.body}
                  // Including `updatedAt` in resetKey forces DocEditor
                  // to re-seed Tiptap when the user picks "Discard mine,
                  // reload" (which mutates the file's body+updatedAt
                  // in-place). Editor still skips redundant setContent
                  // calls thanks to the content-equality guard inside
                  // DocEditor.
                  resetKey={`${activeFile.id}:${activeFile.updatedAt}`}
                  onChange={updateActiveBody}
                />
              )}
            </div>
          </div>

          {historyOpen && (
            <SkillHistoryPanel
              slug={skill.slug}
              canEdit={canEdit}
              refreshKey={historyRefreshKey}
              onClose={() => setHistoryOpen(false)}
              onRestored={() => {
                setHistoryRefreshKey((k) => k + 1);
                if (isEditorAtRest()) void pullFreshSkill();
              }}
            />
          )}

          {/* Right rail */}
          <aside className="w-72 shrink-0 flex flex-col border-l border-border-default overflow-hidden">
            <KbPicker
              kbs={workspaceKbs}
              referenced={referencedKbSlugs}
              onToggle={toggleKb}
              workspaceSlug={workspaceSlug}
            />
            <HealthStrip issues={lintIssues} />
            <ActivityStrip usage={usage} />
            <UsedByStrip usedBy={usedBy} />
            <ConnectorsStrip connectors={skill.connectors} />
          </aside>
        </div>
      </div>
    </div>
  );
}

// ── Header actions (duplicate / export) ─────────────────────────────

function HeaderActions({
  slug,
  workspaceSlug,
  canEdit,
}: {
  slug: string;
  workspaceSlug: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <a
        href={`/api/skills/${encodeURIComponent(slug)}/export`}
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
              const created = await duplicateSkill(slug);
              toast({ title: "Skill duplicated", description: created.skill.name });
              router.push(`/${workspaceSlug}/skills/${created.skill.slug}`);
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

// ── Health strip ─────────────────────────────────────────────────────

function HealthStrip({ issues }: { issues: SkillLintIssue[] }) {
  const errors = issues.filter((i) => i.level === "error").length;
  return (
    <div className="border-t border-border-subtle px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-label font-semibold uppercase tracking-wide text-text-secondary">
          <ShieldCheck size={11} className={errors > 0 ? "text-danger" : issues.length > 0 ? "text-warning" : "text-success"} />
          Health
        </span>
        <span className="text-micro text-text-muted">
          {issues.length === 0 ? "all checks pass" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {issues.length > 0 && (
        <ul className="space-y-1">
          {issues.map((issue, i) => (
            <li
              key={i}
              className={cn(
                "text-caption leading-snug",
                issue.level === "error" ? "text-danger" : "text-text-secondary"
              )}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Agent-activity strip ─────────────────────────────────────────────

function ActivityStrip({ usage }: { usage: SkillUsage }) {
  const last = usage.lastUsedAt
    ? new Date(usage.lastUsedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;
  return (
    <div className="border-t border-border-subtle px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          Agent activity
        </span>
        <span className="text-micro text-text-muted">30d</span>
      </div>
      <p className="text-caption leading-relaxed text-text-secondary">
        {usage.count30d === 0
          ? "No agent reads yet."
          : `${usage.count30d} read${usage.count30d === 1 ? "" : "s"}${last ? ` · last ${last}` : ""}`}
      </p>
    </div>
  );
}

// ── Used-by strip ────────────────────────────────────────────────────

function UsedByStrip({ usedBy }: { usedBy: SkillUsedBy }) {
  const total = usedBy.clusters.length + usedBy.workflows.length;
  return (
    <div className="border-t border-border-subtle px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          Used by
        </span>
        <span className="text-micro text-text-muted">{total}</span>
      </div>
      {total === 0 ? (
        <p className="text-caption leading-relaxed text-text-muted">
          Not attached to any cluster or workflow yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {usedBy.clusters.map((c) => (
            <span
              key={`c-${c.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-bg-inset px-2 py-0.5 text-caption text-text-primary"
            >
              <Layers size={10} className="text-text-muted" />
              <span className="max-w-[140px] truncate">{c.name}</span>
            </span>
          ))}
          {usedBy.workflows.map((w) => (
            <span
              key={`w-${w.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-raised-1 px-2 py-0.5 text-caption text-text-secondary"
            >
              <Workflow size={10} className="text-text-muted" />
              <span className="max-w-[140px] truncate">{w.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── KB picker rail ───────────────────────────────────────────────────

interface KbPickerProps {
  kbs: WorkspaceKbSummary[];
  referenced: Set<string>;
  onToggle: (kb: WorkspaceKbSummary) => void;
  workspaceSlug: string;
}

function KbPicker({ kbs, referenced, onToggle }: KbPickerProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          Knowledge bases
        </span>
        <span className="text-micro text-text-muted">
          {referenced.size}/{kbs.length}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
        {kbs.length === 0 ? (
          <p className="px-2 py-3 text-caption text-text-muted leading-relaxed">
            No knowledge bases in this workspace yet.
          </p>
        ) : (
          kbs.map((kb) => {
            const linked = referenced.has(kb.slug);
            return (
              <button
                key={kb.slug}
                type="button"
                onClick={() => onToggle(kb)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer",
                  linked
                    ? "bg-bg-inset hover:bg-bg-inset-hover"
                    : "hover:bg-surface-raised-2"
                )}
              >
                <span
                  className={cn(
                    "shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                    linked
                      ? "border-border-active bg-surface-invert"
                      : "border-border-strong"
                  )}
                >
                  {linked && <Check size={10} className="text-text-on-invert" />}
                </span>
                <BookOpen
                  size={11}
                  className={cn(
                    "shrink-0",
                    linked ? "text-text-primary" : "text-text-muted"
                  )}
                />
                <span className="flex-1 min-w-0 truncate text-body text-text-primary">
                  {kb.name}
                </span>
                <span className="shrink-0 text-micro text-text-muted">
                  {kb.slug}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Connectors strip ─────────────────────────────────────────────────

function ConnectorsStrip({
  connectors,
}: {
  connectors: Skill["connectors"];
}) {
  if (connectors.length === 0) return null;
  return (
    <div className="border-t border-border-subtle px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          Connectors
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {connectors.map((c) => {
          const known = KNOWN_PROVIDERS.has(c.provider);
          return (
            <span
              key={c.provider}
              className={cn(
                "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-caption",
                c.status === "connected"
                  ? "bg-bg-inset text-text-primary border border-border-strong"
                  : "bg-surface-raised-1 text-text-secondary border border-border-subtle"
              )}
              title={c.usedFor}
            >
              {known && <SourceIcon provider={c.provider as SourceProvider} size="sm" />}
              <span>{c.name}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

