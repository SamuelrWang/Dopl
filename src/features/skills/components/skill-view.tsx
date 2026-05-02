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
  createSkillFile,
  deleteSkillFile,
  fetchSkill,
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
  const slugRef = useRef(skill.slug);
  useEffect(() => {
    slugRef.current = skill.slug;
  }, [skill.slug]);

  const flushSave = useCallback(
    async (fileId: string, fileName: string, body: string) => {
      pendingBodiesRef.current.delete(fileId);
      setSaveStatus("saving");
      try {
        const updated = await writeSkillFile(slugRef.current, fileName, body);
        setFiles((prev) =>
          prev.map((f) => (f.id === fileId ? updated : f))
        );
        setSaveStatus("saved");
        // Reset the indicator after a short window unless another edit
        // has already moved it back to "dirty".
        setTimeout(() => {
          setSaveStatus((prev) => (prev === "saved" ? "idle" : prev));
        }, 1800);
      } catch (err) {
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
  // typing. We can't surface errors here — component is unmounting —
  // so they end up in the dev console only.
  useEffect(() => {
    const timers = timersRef.current;
    const pending = pendingBodiesRef.current;
    return () => {
      const slug = slugRef.current;
      for (const [fileId, timer] of timers) {
        clearTimeout(timer);
        const body = pending.get(fileId);
        const fileName = pending.get(`__name:${fileId}`);
        if (body !== undefined && fileName !== undefined) {
          writeSkillFile(slug, fileName, body).catch(() => {});
        }
      }
      timers.clear();
      pending.clear();
    };
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
      // Track filename alongside the pending body so unmount-flush can
      // resolve the URL even if local state changes mid-save.
      pendingBodiesRef.current.set(`__name:${activeFile.id}`, activeFile.name);
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
              {activeFile && (
                <DocEditor
                  key={activeFile.id}
                  initialMarkdown={activeFile.body}
                  resetKey={activeFile.id}
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

