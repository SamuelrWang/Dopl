"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  MoreHorizontal,
  Play,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { useRefetchOnFocus } from "@/shared/hooks/use-refetch-on-focus";
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
} from "@/features/knowledge/components/doc-editor";
import { SourceIcon } from "@/features/knowledge/components/source-icon";
import type { SourceProvider } from "@/features/knowledge/source-types";
import {
  PRIMARY_SKILL_FILE_NAME,
  type ResolvedSkill,
  type Skill,
  type SkillFile,
  type WorkspaceKbSummary,
} from "@/features/skills/types";
import { parseSkillBody } from "@/features/skills/skill-body";
import {
  SkillApiError,
  createSkillFile,
  deleteSkillFile,
  fetchSkill,
  readSkillFile,
  renameSkillFile,
  writeSkillFile,
} from "@/features/skills/client/api";
import { FileTabs } from "./skill-file-tabs";
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
export function SkillView({ resolved, workspaceKbs, workspaceSlug }: Props) {
  const { skill } = resolved;

  const [files, setFiles] = useState<SkillFile[]>(() =>
    sortFiles(resolved.files)
  );
  const [activeFileId, setActiveFileId] = useState<string>(
    () => primaryFileId(resolved.files) ?? resolved.files[0]?.id ?? ""
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
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
  const conflictRef = useRef<typeof conflict>(null);
  conflictRef.current = conflict;

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

  // When the user switches back to this tab AND nothing is mid-save,
  // pull the freshest version of the skill so changes another tab or
  // an MCP agent saved while away show up automatically. The skip
  // check stops us from clobbering keystrokes the user has buffered.
  useRefetchOnFocus(
    async () => {
      const fresh = await fetchSkill(slugRef.current).catch(() => null);
      if (!fresh) return;
      setFiles(sortFiles(fresh.files));
      // If the active tab still exists in the new payload, keep it;
      // otherwise fall back to SKILL.md (or the first file).
      setActiveFileId((prev) => {
        if (fresh.files.some((f) => f.id === prev)) return prev;
        return primaryFileId(fresh.files) ?? fresh.files[0]?.id ?? prev;
      });
    },
    {
      skip: () =>
        timersRef.current.size > 0 || pendingBodiesRef.current.size > 0,
    }
  );

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
    <>
      <PageTopBar
        title={skill.name}
        trailing={
          <>
            <SaveStatusIndicator state={saveStatus} />
            <button
              type="button"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/[0.08] hover:bg-white/[0.04] transition-colors text-xs text-text-primary cursor-pointer"
            >
              <Play size={12} />
              Test in Claude Code
            </button>
            <button
              type="button"
              aria-label="More"
              className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/[0.04] transition-colors cursor-pointer"
            >
              <MoreHorizontal size={13} className="text-text-secondary" />
            </button>
          </>
        }
      />

      <div className="fixed top-[52px] right-0 bottom-0 left-0 md:left-64 z-[3] p-3 pointer-events-auto">
        <div
          className="h-full rounded-2xl border border-white/[0.1] bg-[var(--panel-surface)] overflow-hidden flex"
          style={{ backgroundColor: "oklch(0.13 0 0)" }}
        >
          {/* Main column */}
          <div className="flex-1 min-w-0 flex flex-col">
            <FileTabs
              files={files}
              activeId={activeFile?.id ?? ""}
              onSelect={setActiveFileId}
              onAdd={handleAddFile}
              onRemove={handleRemoveFile}
              onRename={handleRenameFile}
            />
            <div className="flex-1 min-h-0 overflow-y-auto">
              {activeFile && conflict && conflict.fileId === activeFile.id && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2 text-[12px] leading-relaxed text-amber-100/90"
                >
                  <AlertTriangle
                    size={13}
                    className="shrink-0 text-amber-300/90"
                  />
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
                    className="rounded-md border border-white/[0.1] bg-white/[0.02] px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white/95 disabled:opacity-40"
                  >
                    Discard mine, reload
                  </button>
                  <button
                    type="button"
                    onClick={handleKeepMine}
                    disabled={saveStatus === "saving"}
                    className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-100/95 transition-colors hover:bg-amber-400/15 disabled:opacity-40"
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

          {/* Right rail */}
          <aside className="w-72 shrink-0 flex flex-col border-l border-white/[0.08] overflow-hidden">
            <KbPicker
              kbs={workspaceKbs}
              referenced={referencedKbSlugs}
              onToggle={toggleKb}
              workspaceSlug={workspaceSlug}
            />
            <ConnectorsStrip connectors={skill.connectors} />
          </aside>
        </div>
      </div>
    </>
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
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/70">
          Knowledge bases
        </span>
        <span className="text-[10px] font-mono text-text-secondary/50">
          {referenced.size}/{kbs.length}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
        {kbs.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-text-secondary/60 leading-relaxed">
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
                    ? "bg-violet-500/10 hover:bg-violet-500/15"
                    : "hover:bg-white/[0.04]"
                )}
              >
                <span
                  className={cn(
                    "shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                    linked
                      ? "border-violet-400/60 bg-violet-500/20"
                      : "border-white/[0.15]"
                  )}
                >
                  {linked && <Check size={10} className="text-violet-200" />}
                </span>
                <BookOpen
                  size={11}
                  className={cn(
                    "shrink-0",
                    linked ? "text-violet-300" : "text-text-secondary/60"
                  )}
                />
                <span className="flex-1 min-w-0 truncate text-[12.5px] text-text-primary/90">
                  {kb.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-text-secondary/50">
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
    <div className="border-t border-white/[0.06] px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/70">
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
                "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px]",
                c.status === "connected"
                  ? "bg-emerald-500/10 text-text-primary border border-emerald-500/20"
                  : "bg-white/[0.03] text-text-secondary border border-white/[0.06]"
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

