"use client";

import { useMemo, useState } from "react";
import { Info, SendHorizontal, WifiOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { FIELD_WELL } from "@/shared/ui/wells";
import type { ChannelMember, TaskMode } from "../types";
import { AddressPicker } from "./address-picker";

export interface SendOptions {
  toUserId?: string;
  summary?: string;
}

/** Payload for creating a first-class task from the composer (Task mode). */
export interface CreateTaskInput {
  title: string;
  body: string;
  toUserId: string;
  mode: TaskMode;
}

/** Which composer surface is active: a plain message or a titled task. */
type ComposerMode = "message" | "task";

interface Props {
  /** Resolve when the send settles; a rejection keeps the text for retry. */
  onSend: (body: string, opts?: SendOptions) => Promise<void>;
  /** Resolve when the create settles; a rejection keeps the fields for retry. */
  onCreateTask: (input: CreateTaskInput) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  /** Channel roster (with presence) for the addressing picker. */
  members: ChannelMember[];
  currentUserId: string;
  /**
   * True in a direct (1:1) channel. A DM has exactly one peer, so there is no
   * one to pick: the addressing row is hidden and every human send auto-targets
   * that peer (`toUserId = peer`) in both Message and Task mode.
   */
  isDirect?: boolean;
}

/**
 * Message composer pinned to the bottom of the thread. A kit
 * `SegmentedControl` at the top switches between two surfaces:
 *
 * - Message: a concave-field well with an auto-submitting textarea (Enter
 *   sends, Shift+Enter adds a newline) and a raised send button. Above the
 *   well, an optional addressing row targets one teammate's agent (`toUserId`)
 *   with a one-line intent (`summary`); in a DM the peer is implicit, so only
 *   the optional one-liner shows.
 * - Task: a titled, mode-tagged unit of work. Title + body + a target agent +
 *   an interactive / autonomous toggle, submitted via `onCreateTask`.
 *
 * In a DM every human send auto-addresses the peer. In a channel of three or
 * more, an UNADDRESSED message triggers no agent at all (the targeting rule
 * only implies a recipient in a two-person channel), so the composer says so
 * rather than letting the message land silently.
 */
export function MessageComposer({
  onSend,
  onCreateTask,
  disabled,
  placeholder,
  members,
  currentUserId,
  isDirect,
}: Props) {
  const [mode, setMode] = useState<ComposerMode>("message");
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [toUserId, setToUserId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskBody, setTaskBody] = useState("");
  const [taskMode, setTaskMode] = useState<TaskMode>("interactive");

  // The peer of a direct channel is the one other member; every DM send
  // auto-targets it, so a stale picked addressee can never color a direct send.
  const peerId = useMemo(
    () =>
      isDirect
        ? members.find((m) => m.userId !== currentUserId)?.userId ?? null
        : null,
    [isDirect, members, currentUserId]
  );

  // The agent a send/create actually reaches: the DM peer, else the picked
  // addressee (null in a channel = an unaddressed broadcast, Message mode only).
  const resolvedTargetId = isDirect ? peerId : toUserId;
  const target = useMemo(
    () =>
      resolvedTargetId
        ? members.find((m) => m.userId === resolvedTargetId) ?? null
        : null,
    [resolvedTargetId, members]
  );

  const trimmedTitle = taskTitle.trim();
  const canSendMessage = value.trim().length > 0 && !sending && !disabled;
  const canCreateTask =
    trimmedTitle.length > 0 &&
    trimmedTitle.length <= 200 &&
    taskBody.trim().length > 0 &&
    resolvedTargetId !== null &&
    !sending &&
    !disabled;
  const canSubmit = mode === "message" ? canSendMessage : canCreateTask;

  // Two members = the other one is the implicit target, so an unaddressed
  // message still reaches an agent. Three or more and it reaches none. A DM
  // never shows this (it always has an implicit peer); Task mode never shows it
  // (a task must be addressed to a runner).
  const showUnaddressedHint =
    mode === "message" && !isDirect && !toUserId && members.length >= 3;

  function switchMode(next: ComposerMode) {
    if (next === mode) return;
    setMode(next);
    // Reset the contextual selectors so a target/summary from one surface never
    // leaks into the other. The body drafts (message + task) stay put.
    setToUserId(null);
    setSummary("");
    setTaskMode("interactive");
  }

  async function sendMessage() {
    if (!canSendMessage) return;
    const body = value.trim();
    let opts: SendOptions | undefined;
    if (isDirect) {
      opts = peerId
        ? { toUserId: peerId, summary: summary.trim() || undefined }
        : undefined;
    } else if (toUserId) {
      opts = {
        toUserId,
        summary: summary.trim() || body.split("\n")[0].slice(0, 200),
      };
    }
    setSending(true);
    try {
      await onSend(body, opts);
      setValue("");
      setSummary("");
      setToUserId(null);
    } catch {
      // Keep the text so the user can retry; the caller surfaces the error.
    } finally {
      setSending(false);
    }
  }

  async function createTask() {
    if (!canCreateTask || !resolvedTargetId) return;
    setSending(true);
    try {
      await onCreateTask({
        title: trimmedTitle,
        body: taskBody.trim(),
        toUserId: resolvedTargetId,
        mode: taskMode,
      });
      setTaskTitle("");
      setTaskBody("");
      setTaskMode("interactive");
      setToUserId(null);
    } catch {
      // Keep the fields so the user can retry; the caller surfaces the error.
    } finally {
      setSending(false);
    }
  }

  function submit() {
    if (mode === "message") void sendMessage();
    else void createTask();
  }

  const offlineHint = target && !target.agentOnline && (
    <div className="mb-2 flex items-center gap-1.5 text-caption text-text-muted">
      <WifiOff size={12} className="shrink-0" />
      {target.lastSeenAt === null
        ? "Their agent has never connected. Nothing picks this up until they set up the desktop app."
        : "Their agent is offline. This will run when it reconnects."}
    </div>
  );

  return (
    <div className="shrink-0 px-14 pb-5 pt-2">
      <div className="mx-auto max-w-[760px]">
        <SegmentedControl
          options={[
            { key: "message" as const, label: "Message" },
            { key: "task" as const, label: "Task" },
          ]}
          value={mode}
          onChange={switchMode}
          className="mb-2 w-[200px]"
        />

        {mode === "message" ? (
          <>
            {!isDirect ? (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <AddressPicker
                  members={members}
                  currentUserId={currentUserId}
                  value={toUserId}
                  onChange={(next) => {
                    setToUserId(next);
                    if (!next) setSummary("");
                  }}
                />
                {toUserId && (
                  <input
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    maxLength={200}
                    placeholder="One-line intent (optional)"
                    className={cn(
                      FIELD_WELL,
                      "min-w-0 flex-1 rounded-full px-3 py-1 text-caption text-text-primary placeholder:text-text-muted"
                    )}
                  />
                )}
              </div>
            ) : (
              <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                maxLength={200}
                placeholder="One-line intent (optional)"
                className={cn(
                  FIELD_WELL,
                  "mb-2 w-full rounded-full px-3 py-1 text-caption text-text-primary placeholder:text-text-muted"
                )}
              />
            )}

            {offlineHint}

            {showUnaddressedHint && (
              <div className="mb-2 flex items-center gap-1.5 text-caption text-text-muted">
                <Info size={12} className="shrink-0" />
                No agent will pick this up unless you address it.
              </div>
            )}

            <div className="concave-field flex items-end gap-2 rounded-[12px] px-3 py-2">
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={1}
                disabled={disabled}
                placeholder={placeholder ?? "Message the channel"}
                spellCheck
                className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-body leading-relaxed text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
              />
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                aria-label="Send message"
                className={cn(
                  "mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition-colors",
                  canSubmit ? "btn-light text-text-primary" : "text-text-disabled"
                )}
              >
                <SendHorizontal size={15} />
              </button>
            </div>
          </>
        ) : (
          <>
            {!isDirect && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <AddressPicker
                  members={members}
                  currentUserId={currentUserId}
                  value={toUserId}
                  onChange={setToUserId}
                />
                {!toUserId && (
                  <span className="text-caption text-text-muted">
                    Pick the agent that runs this task.
                  </span>
                )}
              </div>
            )}

            {offlineHint}

            <input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              maxLength={200}
              disabled={disabled}
              placeholder="Task title"
              className="concave-field mb-2 h-9 w-full rounded-[9px] px-3 text-body text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
            />

            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
                Mode
              </span>
              <SegmentedControl
                options={[
                  { key: "interactive" as const, label: "Interactive" },
                  { key: "autonomous" as const, label: "Autonomous" },
                ]}
                value={taskMode}
                onChange={setTaskMode}
                className="w-[220px]"
              />
            </div>
            <p className="mb-2 text-caption text-text-muted">
              {taskMode === "interactive"
                ? "You stay in the loop and approve each step."
                : "The agent runs the task through on its own."}
            </p>

            <div className="concave-field flex items-end gap-2 rounded-[12px] px-3 py-2">
              <textarea
                value={taskBody}
                onChange={(e) => setTaskBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void createTask();
                  }
                }}
                rows={1}
                disabled={disabled}
                placeholder="Describe the task"
                spellCheck
                className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-body leading-relaxed text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
              />
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                aria-label="Create task"
                className={cn(
                  "mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition-colors",
                  canSubmit ? "btn-light text-text-primary" : "text-text-disabled"
                )}
              >
                <SendHorizontal size={15} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
