"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Plus, Save, Trash2, X } from "lucide-react";
import type { SkillPanelData } from "../../types";
import { useCanvasScope } from "../../canvas-store";
import { ClusterAttachmentBanner } from "../cluster-attachment-banner";
import { useSkillsRealtime } from "@/features/skills/client/realtime";
import {
  SkillApiError,
  createSkillFile,
  deleteSkillFile,
  fetchSkill,
  readSkillFile,
  updateSkill,
  writeSkillFile,
} from "@/features/skills/client/api";
import type { ResolvedSkill, SkillFile } from "@/features/skills/types";
import { PRIMARY_SKILL_FILE_NAME } from "@/features/skills/types";

interface Props {
  panel: SkillPanelData;
}

export function SkillPanelBody({ panel }: Props) {
  const scope = useCanvasScope();
  const [resolved, setResolved] = useState<ResolvedSkill | null>(null);
  const [activeFileName, setActiveFileName] = useState<string>(
    PRIMARY_SKILL_FILE_NAME
  );
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSkill(panel.slug, scope?.workspaceId)
      .then((r) => {
        if (cancelled) return;
        setResolved(r);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorText(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [panel.slug, tick, scope?.workspaceId]);

  function refetch() {
    setTick((t) => t + 1);
  }

  useSkillsRealtime(scope?.workspaceId, refetch);

  if (loading && !resolved) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-white/40">
        Loading…
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-red-400">
        {errorText || "Skill not found"}
      </div>
    );
  }

  const { skill, files } = resolved;
  const activeFile =
    files.find((f) => f.name === activeFileName) ??
    files.find((f) => f.name === PRIMARY_SKILL_FILE_NAME) ??
    files[0] ??
    null;

  return (
    <div className="flex h-full w-full flex-col">
      <ClusterAttachmentBanner panelId={panel.id} />
      <SkillHeader
        skill={skill}
        workspaceId={scope?.workspaceId}
        onSaved={refetch}
      />

      {errorText && (
        <div className="border-b border-white/[0.06] bg-red-500/5 px-4 py-1 text-[10px] text-red-400">
          {errorText}
        </div>
      )}

      <FileTabs
        files={files}
        active={activeFile?.name ?? null}
        onSelect={(n) => setActiveFileName(n)}
        onAdd={async () => {
          const name = window.prompt("File name (.md)");
          if (!name) return;
          try {
            const file = await createSkillFile(skill.slug, { name, body: "" });
            setActiveFileName(file.name);
            refetch();
          } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to create");
          }
        }}
        onDelete={async (file) => {
          if (file.name === PRIMARY_SKILL_FILE_NAME) return;
          if (!confirm(`Delete ${file.name}?`)) return;
          try {
            await deleteSkillFile(skill.slug, file.name);
            if (activeFileName === file.name) {
              setActiveFileName(PRIMARY_SKILL_FILE_NAME);
            }
            refetch();
          } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to delete");
          }
        }}
      />

      <div className="flex-1 min-h-0">
        {activeFile && (
          <FileEditor
            key={`${skill.slug}:${activeFile.name}`}
            slug={skill.slug}
            file={activeFile}
            workspaceId={scope?.workspaceId}
            onSaved={refetch}
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-header (metadata editable) ───────────────────────────────────
//
// Concurrency model — never silently overwrite the user's edits:
//
//  - Every PATCH carries an `expectedUpdatedAt` precondition. The
//    server returns 412 SKILL_STALE_VERSION on mismatch.
//  - When a prop refresh comes in (realtime echo, parent refetch),
//    we sync ONLY if the user has no unsaved edits. Otherwise we
//    keep their typing — the next save will 412 and surface a
//    conflict resolution UI.
//  - On 412 we fetch the server's current row, populate a local
//    conflict snapshot, and offer "Save mine / Discard mine".
//  - Unmount flush fires a final PATCH for unsaved metadata when not
//    in conflict, so closing the panel doesn't drop dirty state.

interface SkillHeaderConflict {
  serverName: string;
  serverDescription: string;
  serverWhenToUse: string;
  serverStatus: "active" | "draft";
  serverUpdatedAt: string;
}

function SkillHeader({
  skill,
  workspaceId,
  onSaved,
}: {
  skill: ResolvedSkill["skill"];
  workspaceId: string | undefined;
  onSaved: () => void;
}) {
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [whenToUse, setWhenToUse] = useState(skill.whenToUse);
  const [status, setStatus] = useState(skill.status);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SkillHeaderConflict | null>(null);

  // Refs that the unmount-flush captures. The flush reads them so a
  // background save uses the user's freshest typing even if React
  // state inside cleanup is stale.
  const latestRef = useRef({ name, description, whenToUse, status });
  useEffect(() => {
    latestRef.current = { name, description, whenToUse, status };
  });
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const conflictRef = useRef<SkillHeaderConflict | null>(null);
  conflictRef.current = conflict;

  // Baseline `updated_at` we last synced from. Drives both the
  // optimistic-concurrency precondition and the prop-sync gate.
  const baselineUpdatedAtRef = useRef(skill.updatedAt);
  // Stable identity of the skill we're currently editing — used by
  // the unmount-flush so it doesn't try to PATCH the wrong slug if
  // the user navigated away mid-flight.
  const slugRef = useRef(skill.slug);
  slugRef.current = skill.slug;

  // Sync from prop ONLY when the user has no unsaved edits and is not
  // in a pending conflict. The dep is the server's updatedAt — when
  // it changes (and we're clean), pull all fields.
  useEffect(() => {
    if (skill.updatedAt === baselineUpdatedAtRef.current) return;
    if (dirtyRef.current || conflictRef.current) return;
    setName(skill.name);
    setDescription(skill.description);
    setWhenToUse(skill.whenToUse);
    setStatus(skill.status);
    baselineUpdatedAtRef.current = skill.updatedAt;
  }, [
    skill.id,
    skill.updatedAt,
    skill.name,
    skill.description,
    skill.whenToUse,
    skill.status,
  ]);

  // Unmount flush — fire a final PATCH if dirty AND not in conflict.
  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return;
      if (conflictRef.current !== null) return;
      const latest = latestRef.current;
      const baseline = baselineUpdatedAtRef.current;
      const slug = slugRef.current;
      updateSkill(
        slug,
        {
          name: latest.name,
          description: latest.description,
          whenToUse: latest.whenToUse,
          status: latest.status,
        },
        workspaceId,
        baseline
      ).catch((err: unknown) => {
        if (err instanceof SkillApiError && err.status === 412) {
          console.warn(
            "[skill-panel] unmount autosave dropped (412 stale)",
            { slug }
          );
          return;
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enterConflict(): Promise<boolean> {
    try {
      const fresh = await fetchSkill(slugRef.current, workspaceId);
      setConflict({
        serverName: fresh.skill.name,
        serverDescription: fresh.skill.description,
        serverWhenToUse: fresh.skill.whenToUse,
        serverStatus: fresh.skill.status,
        serverUpdatedAt: fresh.skill.updatedAt,
      });
      return true;
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : "Couldn't load the latest server version"
      );
      return false;
    }
  }

  async function handleSave() {
    if (!dirty || conflict) return;
    setSaving(true);
    setErrorText(null);
    try {
      const saved = await updateSkill(
        slugRef.current,
        { name, description, whenToUse, status },
        workspaceId,
        baselineUpdatedAtRef.current
      );
      baselineUpdatedAtRef.current = saved.updatedAt;
      setDirty(false);
      onSaved();
    } catch (err) {
      if (err instanceof SkillApiError && err.status === 412) {
        await enterConflict();
        return;
      }
      setErrorText(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleKeepMine() {
    if (!conflict) return;
    setSaving(true);
    setErrorText(null);
    try {
      const saved = await updateSkill(
        slugRef.current,
        { name, description, whenToUse, status },
        workspaceId,
        conflict.serverUpdatedAt
      );
      baselineUpdatedAtRef.current = saved.updatedAt;
      setDirty(false);
      setConflict(null);
      onSaved();
    } catch (err) {
      if (err instanceof SkillApiError && err.status === 412) {
        await enterConflict();
        return;
      }
      setErrorText(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function handleDiscardMine() {
    if (!conflict) return;
    setName(conflict.serverName);
    setDescription(conflict.serverDescription);
    setWhenToUse(conflict.serverWhenToUse);
    setStatus(conflict.serverStatus);
    baselineUpdatedAtRef.current = conflict.serverUpdatedAt;
    setDirty(false);
    setConflict(null);
    setErrorText(null);
  }

  return (
    <div className="border-b border-white/[0.06]">
      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2 text-[11px] leading-relaxed text-amber-100/90"
        >
          <span className="min-w-0 flex-1">
            <strong className="font-semibold">Edited elsewhere.</strong> The
            server has a newer version of this skill — your edits are kept
            until you choose.
          </span>
          <button
            type="button"
            onClick={handleDiscardMine}
            disabled={saving}
            className="rounded border border-white/[0.1] bg-white/[0.02] px-2 py-0.5 text-[10px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white/95 disabled:opacity-40"
          >
            Discard mine
          </button>
          <button
            type="button"
            onClick={handleKeepMine}
            disabled={saving}
            className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-100/95 transition-colors hover:bg-amber-400/15 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save mine"}
          </button>
        </div>
      )}
      {errorText && (
        <div className="border-b border-white/[0.06] bg-red-500/5 px-4 py-1 text-[10px] text-red-400">
          {errorText}
        </div>
      )}
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              className="min-w-0 flex-1 truncate bg-transparent font-mono text-[13px] text-white/95 placeholder:text-white/25 focus:outline-none"
              placeholder="skill-slug"
            />
            <button
              type="button"
              onClick={() => {
                setStatus((s) => (s === "active" ? "draft" : "active"));
                setDirty(true);
              }}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors ${
                status === "active"
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300/90"
                  : "border-white/[0.08] bg-white/[0.02] text-white/40 hover:text-white/65"
              }`}
            >
              <span
                className={`h-1 w-1 rounded-full ${
                  status === "active" ? "bg-emerald-400" : "bg-white/40"
                }`}
              />
              {status}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving || conflict !== null}
              className="inline-flex items-center gap-1 rounded-md border border-white/[0.18] bg-white/[0.06] px-2 py-1 text-[10px] text-white/85 transition-colors hover:bg-white/[0.1] disabled:opacity-40"
            >
              <Save size={9} />
              {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </div>
          <input
            type="text"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
            className="mt-1.5 w-full bg-transparent text-[11.5px] leading-relaxed text-white/65 placeholder:text-white/25 focus:outline-none"
            placeholder="Short description"
          />
          <div className="mt-2">
            <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-white/40">
              When to use
            </div>
            <textarea
              value={whenToUse}
              onChange={(e) => {
                setWhenToUse(e.target.value);
                setDirty(true);
              }}
              rows={2}
              className="w-full resize-none bg-transparent text-[11.5px] leading-relaxed text-white/70 placeholder:text-white/25 focus:outline-none"
              placeholder="When the agent should reach for this skill…"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── File tabs ────────────────────────────────────────────────────────

function FileTabs({
  files,
  active,
  onSelect,
  onAdd,
  onDelete,
}: {
  files: SkillFile[];
  active: string | null;
  onSelect: (name: string) => void;
  onAdd: () => void;
  onDelete: (file: SkillFile) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.06] px-3 pt-2">
      {files.map((f) => {
        const isActive = f.name === active;
        const pinned = f.name === PRIMARY_SKILL_FILE_NAME;
        return (
          <div
            key={f.id}
            className={`group inline-flex shrink-0 items-center gap-1 rounded-t-md border-b-2 px-2 py-1.5 font-mono text-[11px] transition-colors ${
              isActive
                ? "border-white/60 bg-white/[0.04] text-white/95"
                : "border-transparent text-white/45 hover:text-white/75"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(f.name)}
              className="inline-flex items-center gap-1.5"
            >
              <FileText size={10} />
              <span className="truncate">{f.name}</span>
            </button>
            {!pinned && isActive && (
              <button
                type="button"
                aria-label={`Delete ${f.name}`}
                onClick={() => onDelete(f)}
                className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-white/35 hover:text-white/85"
              >
                <X size={9} />
              </button>
            )}
            {pinned && (
              <span className="text-[9px] text-white/35">·pinned</span>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] text-white/40 transition-colors hover:text-white/70"
      >
        <Plus size={9} />
        Add file
      </button>
    </div>
  );
}

// ── File editor ──────────────────────────────────────────────────────
//
// Same concurrency model as SkillHeader and EntryEditor:
//
//  - Every PUT carries `expectedUpdatedAt`. Server returns 412 on
//    mismatch; we fetch fresh, surface a conflict banner.
//  - Prop sync gated on dirty + conflict — realtime echo never
//    clobbers unsaved typing.
//  - Unmount flush sends a final PUT for unsaved edits when not in
//    conflict.

interface FileEditorConflict {
  serverBody: string;
  serverUpdatedAt: string;
}

function FileEditor({
  slug,
  file,
  workspaceId,
  onSaved,
}: {
  slug: string;
  file: SkillFile;
  workspaceId: string | undefined;
  onSaved: () => void;
}) {
  const [body, setBody] = useState(file.body);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [conflict, setConflict] = useState<FileEditorConflict | null>(null);

  const latestRef = useRef(body);
  useEffect(() => {
    latestRef.current = body;
  });
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const conflictRef = useRef<FileEditorConflict | null>(null);
  conflictRef.current = conflict;
  const baselineUpdatedAtRef = useRef(file.updatedAt);
  const fileNameRef = useRef(file.name);
  fileNameRef.current = file.name;
  const slugRef = useRef(slug);
  slugRef.current = slug;

  // Sync from the prop ONLY when (a) the server's updatedAt differs
  // from our baseline (i.e. there's actually new content to absorb)
  // AND (b) the user has no unsaved edits and isn't mid-resolution.
  useEffect(() => {
    if (file.updatedAt === baselineUpdatedAtRef.current) return;
    if (dirtyRef.current || conflictRef.current) return;
    setBody(file.body);
    baselineUpdatedAtRef.current = file.updatedAt;
    setErrorText(null);
  }, [file.id, file.updatedAt, file.body]);

  // Unmount flush. Captures slug + workspaceId at mount time.
  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return;
      if (conflictRef.current !== null) return;
      writeSkillFile(
        slugRef.current,
        fileNameRef.current,
        latestRef.current,
        workspaceId,
        baselineUpdatedAtRef.current
      ).catch((err: unknown) => {
        if (err instanceof SkillApiError && err.status === 412) {
          console.warn(
            "[skill-panel] file unmount autosave dropped (412 stale)",
            { slug: slugRef.current, file: fileNameRef.current }
          );
          return;
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enterConflict(): Promise<boolean> {
    try {
      const fresh = await readSkillFile(
        slugRef.current,
        fileNameRef.current,
        workspaceId
      );
      setConflict({
        serverBody: fresh.body,
        serverUpdatedAt: fresh.updatedAt,
      });
      return true;
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : "Couldn't load the latest server version"
      );
      return false;
    }
  }

  async function handleSave() {
    if (!dirty || conflict) return;
    setSaving(true);
    setErrorText(null);
    try {
      const saved = await writeSkillFile(
        slugRef.current,
        fileNameRef.current,
        body,
        workspaceId,
        baselineUpdatedAtRef.current
      );
      baselineUpdatedAtRef.current = saved.updatedAt;
      setDirty(false);
      onSaved();
    } catch (err) {
      if (err instanceof SkillApiError && err.status === 412) {
        await enterConflict();
        return;
      }
      setErrorText(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleKeepMine() {
    if (!conflict) return;
    setSaving(true);
    setErrorText(null);
    try {
      const saved = await writeSkillFile(
        slugRef.current,
        fileNameRef.current,
        body,
        workspaceId,
        conflict.serverUpdatedAt
      );
      baselineUpdatedAtRef.current = saved.updatedAt;
      setDirty(false);
      setConflict(null);
      onSaved();
    } catch (err) {
      if (err instanceof SkillApiError && err.status === 412) {
        await enterConflict();
        return;
      }
      setErrorText(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function handleDiscardMine() {
    if (!conflict) return;
    setBody(conflict.serverBody);
    baselineUpdatedAtRef.current = conflict.serverUpdatedAt;
    setDirty(false);
    setConflict(null);
    setErrorText(null);
  }

  return (
    <div className="flex h-full flex-col">
      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2 text-[11px] leading-relaxed text-amber-100/90"
        >
          <span className="min-w-0 flex-1">
            <strong className="font-semibold">Edited elsewhere.</strong> The
            server has a newer version of this file — your edits are kept
            until you choose.
          </span>
          <button
            type="button"
            onClick={handleDiscardMine}
            disabled={saving}
            className="rounded border border-white/[0.1] bg-white/[0.02] px-2 py-0.5 text-[10px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white/95 disabled:opacity-40"
          >
            Discard mine
          </button>
          <button
            type="button"
            onClick={handleKeepMine}
            disabled={saving}
            className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-100/95 transition-colors hover:bg-amber-400/15 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save mine"}
          </button>
        </div>
      )}
      <div className="flex items-center justify-between px-4 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-white/35">
          {file.name}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving || conflict !== null}
          className="inline-flex items-center gap-1 rounded-md border border-white/[0.18] bg-white/[0.06] px-2 py-1 text-[10px] text-white/85 transition-colors hover:bg-white/[0.1] disabled:opacity-40"
        >
          <Save size={9} />
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </div>
      {errorText && (
        <div className="border-y border-white/[0.06] bg-red-500/5 px-4 py-1 text-[10px] text-red-400">
          {errorText}
        </div>
      )}
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setDirty(true);
        }}
        className="flex-1 min-h-0 resize-none bg-transparent px-4 py-3 font-mono text-[12px] leading-relaxed text-white/85 placeholder:text-white/25 focus:outline-none"
        placeholder="Write markdown here…"
      />
    </div>
  );
}
