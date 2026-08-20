"use client";

/**
 * The Settings tab's DESKTOP-ONLY groups, split out of `settings-agent.tsx` at
 * the 500-line cap — one file per reason to change: these rows exist only
 * inside the desktop shell (each gated on its own bridge upstream — no dead
 * rows), and both drive main-process launch state, never a server write.
 *
 * - **Agent folder** — where this channel's agent RUNS on the operator's Mac.
 *   ⚠ FOR DEVELOPERS, and no longer printed (Samuel, 2026-08-19): CONTEXT, NOT
 *   A SANDBOX. The tool profile applies on top whatever the cwd is
 *   (`main/tool-profiles.js`), so changing the folder never changes what the
 *   agent may do; an unset or vanished path falls back to the isolated sandbox.
 * - **Auto-send** (Samuel, 2026-08-20) — the durable posture for this channel's
 *   OWN-agent replies. OFF: the draft waits in the thread view's send box; ON:
 *   it posts on its own (`main/channel-prefs.js › getAutoSend`).
 */

import { Switch } from "@/shared/ui/switch";
import type { AgentFolderState } from "./settings-agent";

/** The desktop's own folder when the channel names none. */
const FOLDER_DEFAULT_LABEL = "Sandbox (default)";

export function AgentFolderRows({
  folder,
  SettingName,
}: {
  folder: AgentFolderState;
  SettingName: (props: { children: React.ReactNode }) => React.ReactNode;
}) {
  return (
    <>
      <SettingName>Agent folder</SettingName>
      <p className="truncate rounded-[8px] border border-border-subtle bg-bg-inset px-2.5 py-1.5 text-body text-text-primary">
        {folder.label ?? FOLDER_DEFAULT_LABEL}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={folder.onChoose}
          disabled={folder.busy}
          className="btn-light rounded-[8px] px-2.5 py-1.5 text-caption font-medium text-text-primary disabled:opacity-60"
        >
          {folder.busy ? "Opening picker…" : "Change folder…"}
        </button>
        {folder.label && (
          <button
            type="button"
            onClick={folder.onClear}
            disabled={folder.busy}
            className="rounded-[8px] px-2.5 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary disabled:opacity-60"
          >
            Use default
          </button>
        )}
      </div>
    </>
  );
}

export function AutoSendRows({
  autoSend,
  SettingName,
}: {
  autoSend: { on: boolean; busy: boolean; onToggle: (on: boolean) => void };
  SettingName: (props: { children: React.ReactNode }) => React.ReactNode;
}) {
  return (
    <>
      <SettingName>Replies</SettingName>
      <div className="flex h-[38px] items-center gap-2.5 rounded-[8px] px-2">
        <span className="min-w-0 flex-1 truncate text-body text-text-primary">
          Send automatically
        </span>
        {autoSend.busy && (
          <span className="text-caption text-text-muted">Saving…</span>
        )}
        <Switch
          checked={autoSend.on}
          disabled={autoSend.busy}
          onChange={(next) => autoSend.onToggle(next)}
          aria-label="Send replies automatically"
        />
      </div>
    </>
  );
}
