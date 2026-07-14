"use client";

import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import {
  KnowledgeApiError,
  fetchEntry,
  updateEntry,
} from "@/features/knowledge/client/api";
import { DocEditor } from "@/shared/editor/doc-editor";

// ── Entry editor ─────────────────────────────────────────────────────
//
// Concurrency model — never silently overwrite the user's editor:
//
//  - Every PATCH is sent with the entry's `expectedUpdatedAt` so the
//    server returns 412 if a parallel writer beat us.
//  - On 412, we fetch the server's current entry into a local conflict
//    snapshot. The editor's content stays exactly as the user typed
//    it. A banner offers explicit resolution: "Save mine, overwrite"
//    or "Discard mine, reload".
//  - On unmount with unsaved edits AND no pending conflict, we fire
//    one final PATCH with the same precondition so closing the panel
//    via X / drag / undo doesn't drop dirty content. While in
//    conflict we deliberately skip the unmount flush — silent
//    background saves while the user is mid-resolution would
//    overwrite whatever choice they were about to make.

interface EntryEditorConflict {
  serverTitle: string;
  serverBody: string;
  serverUpdatedAt: string;
}

export function EntryEditor({
  entryId,
  workspaceId,
  onSaved,
  canEdit,
}: {
  entryId: string;
  workspaceId: string | undefined;
  onSaved: () => void;
  canEdit: boolean;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<EntryEditorConflict | null>(null);

  // Latest values + flags mirrored into refs so the unmount-flush
  // sees fresh data even when React state inside cleanup is stale.
  const latestRef = useRef({ title, body });
  useEffect(() => {
    latestRef.current = { title, body };
  });
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const conflictRef = useRef<EntryEditorConflict | null>(null);
  conflictRef.current = conflict;
  const expectedUpdatedAtRef = useRef<string | null>(null);
  const lastSavedRef = useRef<{ title: string; body: string } | null>(null);

  // Initial load + entry switch (the parent re-keys EntryEditor by
  // selectedEntryId, so this effect runs once per mount).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEntry(entryId, workspaceId)
      .then((e) => {
        if (cancelled) return;
        setTitle(e.title);
        setBody(e.body);
        setDirty(false);
        setConflict(null);
        expectedUpdatedAtRef.current = e.updatedAt;
        lastSavedRef.current = { title: e.title, body: e.body };
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
  }, [entryId, workspaceId]);

  // Unmount flush — fire a final PATCH if dirty AND not in conflict.
  // Empty-deps intentionally so the cleanup captures the initial
  // entryId/workspaceId snapshot. Refs supply fresh title/body/flags.
  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return;
      if (conflictRef.current !== null) return;
      const last = lastSavedRef.current;
      const latest = latestRef.current;
      if (last && last.title === latest.title && last.body === latest.body) {
        return;
      }
      const expectedUpdatedAt = expectedUpdatedAtRef.current;
      if (!expectedUpdatedAt) return;
      updateEntry(
        entryId,
        { title: latest.title, body: latest.body },
        workspaceId,
        expectedUpdatedAt
      ).catch((err: unknown) => {
        // 412 here means a parallel writer beat us during the unmount
        // window; without an editor to surface a banner we drop the
        // edit. Other errors are also dropped (no UI to retry into).
        if (err instanceof KnowledgeApiError && err.status === 412) {
          console.warn(
            "[knowledge-panel] unmount autosave dropped (412 stale)",
            { entryId }
          );
          return;
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enterConflict(): Promise<boolean> {
    try {
      const fresh = await fetchEntry(entryId, workspaceId);
      setConflict({
        serverTitle: fresh.title,
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
    if (!dirty || conflict || !expectedUpdatedAtRef.current) return;
    setSaving(true);
    setErrorText(null);
    try {
      const updated = await updateEntry(
        entryId,
        { title, body },
        workspaceId,
        expectedUpdatedAtRef.current
      );
      expectedUpdatedAtRef.current = updated.updatedAt;
      lastSavedRef.current = { title, body };
      setDirty(false);
      onSaved();
    } catch (err) {
      if (err instanceof KnowledgeApiError && err.status === 412) {
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
      const updated = await updateEntry(
        entryId,
        { title, body },
        workspaceId,
        conflict.serverUpdatedAt
      );
      expectedUpdatedAtRef.current = updated.updatedAt;
      lastSavedRef.current = { title, body };
      setDirty(false);
      setConflict(null);
      onSaved();
    } catch (err) {
      if (err instanceof KnowledgeApiError && err.status === 412) {
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
    setTitle(conflict.serverTitle);
    setBody(conflict.serverBody);
    expectedUpdatedAtRef.current = conflict.serverUpdatedAt;
    lastSavedRef.current = {
      title: conflict.serverTitle,
      body: conflict.serverBody,
    };
    setDirty(false);
    setConflict(null);
    setErrorText(null);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-muted">
        Loading…
      </div>
    );
  }

  if (errorText && !expectedUpdatedAtRef.current) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-red-400">
        {errorText}
      </div>
    );
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
            server has a newer version — your edits are kept until you choose.
          </span>
          <button
            type="button"
            onClick={handleDiscardMine}
            disabled={saving}
            className="rounded border border-border-default bg-surface-raised-1 px-2 py-0.5 text-[10px] text-text-secondary transition-colors hover:bg-surface-raised-3 hover:text-text-primary disabled:opacity-40"
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
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          className="flex-1 bg-transparent text-sm font-semibold text-text-primary placeholder:text-text-muted focus:outline-none"
          placeholder="Untitled"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving || conflict !== null}
          className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface-raised-3 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface-raised-4 disabled:opacity-40"
        >
          <Save size={10} />
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </div>
      {errorText && (
        <div className="border-b border-border-subtle bg-red-500/5 px-4 py-1 text-[10px] text-red-400">
          {errorText}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <DocEditor
          initialMarkdown={body}
          resetKey={entryId}
          readOnly={!canEdit}
          onChange={(md) => {
            setBody(md);
            setDirty(true);
          }}
        />
      </div>
    </div>
  );
}
