"use client";

import { useMemo, useState } from "react";
import { Info, WifiOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useAutoGrowTextarea } from "@/shared/ui/auto-grow-textarea";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SendButton } from "@/shared/ui/send-button";
import { FIELD_WELL } from "@/shared/ui/wells";
import { GROUP_CHANNEL_MIN_MEMBERS } from "../constants";
import type { ChannelAgent, ChannelMember } from "../types";
import {
  matchingSlashCommands,
  NEW_AGENT_COMMAND,
  parseSlashCommand,
} from "../lib/composer-commands";
import {
  buildComposerPayload,
  composerModeHelp,
  COMPOSER_MODE_OPTIONS,
  DEFAULT_COMPOSER_MODE,
  resolveRequestTarget,
  submitComposerDraft,
  type ComposerMode,
  type SendOptions,
} from "../lib/composer-mode";
import {
  applyMention,
  buildMentionCandidates,
  extractMentionedAgents,
  findMentionQuery,
  mentionPopupHeight,
  type MentionCandidate,
  type MentionQuery,
} from "../lib/mention";
import { AddressPicker } from "./address-picker";
import { MentionPopup, SlashCommandHint } from "./mention-popup";

/** Placeholder + accessible name for the request's title (wire field: `title`). */
const SUBJECT_LABEL = "Subject";

/** Accessible name for the mode toggle. */
export const COMPOSER_MODE_LABEL = "Send as";

export type { SendOptions } from "../lib/composer-mode";

interface Props {
  /** Resolve when the send settles; a rejection keeps the text for retry. */
  onSend: (body: string, opts?: SendOptions) => Promise<void>;
  /**
   * Open a thread addressed to one member (REQUEST mode's whole path). Absent
   * means this surface cannot open threads, so the composer stays in chat.
   */
  onCreateThread?: (input: {
    title: string;
    body: string;
    toUserId: string;
  }) => Promise<unknown>;
  disabled?: boolean;
  placeholder?: string;
  /** Channel roster (with presence) for the addressing picker. */
  members: ChannelMember[];
  currentUserId: string;
  /** The channel's agents — the second population of the @-mention list. */
  agents?: ChannelAgent[];
  /**
   * Summon an agent (`/new-agent [name]`). Absent means the command is not
   * available here and the text posts as an ordinary message.
   */
  onCreateAgent?: (name?: string) => Promise<unknown>;
  /**
   * True in a direct (1:1) channel. A DM has exactly one peer, so there is no
   * one to pick: request mode auto-targets that peer and the picker is hidden.
   */
  isDirect?: boolean;
}

/**
 * Message composer pinned to the bottom of the channel. One unified input: a
 * concave-field well with an auto-submitting textarea (Enter sends, Shift+Enter
 * adds a newline) that AUTO-GROWS to three lines and then scrolls, exactly like
 * the desktop thread window's composer, plus the shared `SendButton`.
 *
 * TWO MODES, chosen on a visible toggle, because sending used to mean exactly
 * one thing and that thing woke someone's machine:
 *
 * - CHAT (default): a plain channel message. No subject, no thread, and no human
 *   addressee. Left alone it reaches nobody's agent, and the line under the
 *   composer says so. @-MENTION an agent and that agent ACTS: the handles are
 *   resolved out of the typed body at send time and travel as `toAgents`, and
 *   the same line changes to name them ("quartz and onyx will act on this"),
 *   because this is the one consequence in the composer that is decided by
 *   characters in the text rather than by a visible control.
 * - REQUEST: the subject field comes back and an addressee is required. Sending
 *   opens a THREAD through the create-thread path (title = subject, body =
 *   message, to = the picked member), which posts the opening message and
 *   starts that member's agent.
 *
 * The mode never silently changes what a draft does: `buildComposerPayload`
 * (lib/composer-mode.ts) is the single decision, chat mode cannot produce a
 * thread, and request mode refuses rather than guessing a missing subject.
 *
 * In a channel of `GROUP_CHANNEL_MIN_MEMBERS` or more, a CHAT message triggers
 * no agent at all (the targeting rule only implies a recipient in a two-person
 * channel). That is now the stated purpose of chat mode rather than a footnote,
 * so the old warning shows only where it is still surprising: a group channel
 * sitting in REQUEST mode with nobody picked.
 */
export function MessageComposer({
  onSend,
  onCreateThread,
  disabled,
  placeholder,
  members,
  currentUserId,
  isDirect,
  agents,
  onCreateAgent,
}: Props) {
  const [mode, setMode] = useState<ComposerMode>(DEFAULT_COMPOSER_MODE);
  const [value, setValue] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [toUserId, setToUserId] = useState<string | null>(null);
  // The `@…` token under the caret, plus the input's measured top-left corner
  // (the list opens UPWARD from it). Both are cleared on send, on dismiss, and
  // whenever the token stops being a mention.
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [mentionOrigin, setMentionOrigin] = useState<
    { x: number; y: number } | null
  >(null);
  // Grows with the typed lines up to three, then scrolls (shared with the
  // thread window's D7 math). Keyed on `value`, so clearing after a send snaps
  // the field back to one line.
  const textareaRef = useAutoGrowTextarea(value);

  // The peer of a direct channel is the one other member; a DM request
  // auto-targets it, so a stale picked addressee can never color a direct send.
  const peerId = useMemo(
    () =>
      isDirect
        ? members.find((m) => m.userId !== currentUserId)?.userId ?? null
        : null,
    [isDirect, members, currentUserId]
  );

  const draft = {
    mode,
    body: value,
    subject,
    isDirect: Boolean(isDirect),
    peerId,
    toUserId,
    agents: agents ?? [],
  };

  // The agents the CURRENT text addresses. Recomputed per keystroke because it
  // is what the helper line promises and what the send will actually carry —
  // deleting a handle has to take the promise with it.
  const mentionedAgents = useMemo(
    () => (mode === "chat" ? extractMentionedAgents(value, agents ?? []) : []),
    [mode, value, agents]
  );

  // Who a REQUEST would reach. Null in chat mode's rendering too, because a
  // chat send has no target by construction.
  const targetId = mode === "request" ? resolveRequestTarget(draft) : null;
  const target = useMemo(
    () => (targetId ? members.find((m) => m.userId === targetId) ?? null : null),
    [targetId, members]
  );
  // A real name when we have one; never a raw user id in prose. Null only when
  // there is no target at all, which is what makes the help line say what is
  // still missing instead of naming a nonexistent person.
  const targetName = targetId
    ? target?.displayName || target?.email || "your teammate"
    : null;

  // `/new-agent` is a valid submit with no addressee and no subject, so it
  // bypasses the draft rule. Matched EXACTLY (not by prefix) so a half-typed
  // `/new` in request mode doesn't light the send button.
  const isCommandDraft =
    Boolean(onCreateAgent) &&
    parseSlashCommand(value.trim())?.name === NEW_AGENT_COMMAND;
  // Built ONCE and read twice: the send button needs the boolean, the help line
  // needs the REASON. Reading only the boolean is how a request with no subject
  // greyed out the button while the line still promised to start someone's agent.
  const built = buildComposerPayload(draft);
  const canSend = (built.ok || isCommandDraft) && !sending && !disabled;

  // The old N-party warning, narrowed: chat mode reaching no agent is now the
  // POINT, so the hint would be noise there. It fires only where an operator
  // still expects a pickup and won't get one — request mode, group channel, no
  // addressee picked. An unloaded roster is length 0, so the hint is absent
  // rather than wrong while members resolve.
  const showUnaddressedHint =
    mode === "request" &&
    !isDirect &&
    !toUserId &&
    members.length >= GROUP_CHANNEL_MIN_MEMBERS;

  // The command hint is a discovery affordance: it shows the moment the draft
  // starts with `/` and narrows as the name is typed.
  const slashCommands = onCreateAgent ? matchingSlashCommands(value) : [];

  const mentionCandidates = useMemo(
    () =>
      mention
        ? buildMentionCandidates({
            query: mention.query,
            members,
            agents: agents ?? [],
            currentUserId,
          })
        : [],
    [mention, members, agents, currentUserId]
  );

  // Opened UPWARD off the input's top edge, so the list never covers the text
  // being typed (the composer is pinned to the bottom of the pane).
  const mentionAnchor = mentionOrigin
    ? {
        x: mentionOrigin.x,
        y: mentionOrigin.y - mentionPopupHeight(mentionCandidates.length) - 8,
      }
    : null;

  /** Recompute the open mention token after any edit / caret move. */
  function syncMention(el: HTMLTextAreaElement) {
    const next = findMentionQuery(el.value, el.selectionStart ?? el.value.length);
    setMention(next);
    if (!next) {
      setMentionOrigin(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setMentionOrigin({ x: rect.left, y: rect.top });
  }

  function acceptMention(candidate: MentionCandidate) {
    if (!mention) return;
    const next = applyMention(value, mention, candidate.insert);
    setValue(next.value);
    setMention(null);
    setMentionOrigin(null);
    const el = textareaRef.current;
    if (el) {
      // Restore the caret after React commits the new value.
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    }
  }

  /**
   * Clear a field ONLY if it still holds what was sent.
   *
   * A send is an await, and the composer stays typable across it. The old
   * unconditional `setValue("")` therefore destroyed whatever the operator typed
   * while the request was in flight — silently, and with no undo, because the
   * text never existed anywhere else. Comparing against the snapshot means a
   * settled send clears its own draft and leaves a new one alone.
   */
  function clearIfUnchanged(
    set: (updater: (current: string) => string) => void,
    sent: string
  ) {
    set((current) => (current === sent ? "" : current));
  }

  async function sendMessage() {
    if (!canSend) return;
    const sentBody = value;
    const sentSubject = subject;
    setSending(true);
    try {
      const result = await submitComposerDraft({
        ...draft,
        onSend,
        onCreateThread,
        onCreateAgent,
      });
      if (result === "blocked") return;
      clearIfUnchanged(setValue, sentBody);
      setMention(null);
      setMentionOrigin(null);
      // `/new-agent` is an ASIDE, not a send: it summons and posts nothing, so
      // it must not take a half-composed request down with it. The subject and
      // the picked addressee survive it and are cleared only by an actual send.
      if (result === "created") return;
      clearIfUnchanged(setSubject, sentSubject);
      setToUserId(null);
    } catch {
      // Keep the text so the user can retry; the caller surfaces the error.
    } finally {
      setSending(false);
    }
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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {/* THE TOGGLE'S ACCESSIBLE NAME lives on this wrapper rather than on
              the control: `SegmentedControl` is a shared kit primitive
              (`shared/ui`) that renders its own `role="tablist"` and takes
              neither an `aria-label` nor a `disabled` prop, and it is outside
              this lane's scope to change. A named group around it is the
              honest in-scope fix; the kit should grow the prop.

              LOCKED WHILE SENDING for the same reason the text is no longer
              clobbered: the mode decides what the in-flight request WAS, so
              flipping it mid-send left the line below describing a consequence
              that no longer matched anything. `pointer-events-none` stops the
              click and the `sending` guard stops the keyboard path. */}
          <div
            role="group"
            aria-label={COMPOSER_MODE_LABEL}
            aria-disabled={sending || undefined}
            className={cn("shrink-0", sending && "pointer-events-none opacity-60")}
          >
            <SegmentedControl
              options={COMPOSER_MODE_OPTIONS}
              value={mode}
              onChange={(next) => {
                if (!sending) setMode(next);
              }}
              className="w-[168px]"
            />
          </div>
          {/* The addressing row belongs to REQUEST only: a chat message has no
              addressee, so offering one would be an affordance that does
              nothing. A DM's peer is implicit, so it shows no picker either. */}
          {mode === "request" && !isDirect && (
            <AddressPicker
              members={members}
              currentUserId={currentUserId}
              value={toUserId}
              onChange={setToUserId}
            />
          )}
          {mode === "request" && (
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder={SUBJECT_LABEL}
              aria-label={SUBJECT_LABEL}
              className={cn(
                FIELD_WELL,
                "min-w-0 flex-1 rounded-full px-3 py-1 text-caption text-text-primary placeholder:text-text-muted"
              )}
            />
          )}
        </div>

        {offlineHint}

        {showUnaddressedHint && (
          <div className="mb-2 flex items-center gap-1.5 text-caption text-text-muted">
            <Info size={12} className="shrink-0" />
            No agent will pick this up unless you address it.
          </div>
        )}

        <SlashCommandHint commands={slashCommands} />

        <div className="concave-field flex items-end gap-2 rounded-[12px] px-3 py-2">
          {/* rows=1 + the min/max heights keep CSS and the growHeight() math in
              agreement: one line at rest, three lines then scroll. The inline
              height the hook sets rides inside that clamp. leading-relaxed is
              1.625em per line, py-1 is 8px of vertical padding. */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              syncMention(e.currentTarget);
            }}
            // Caret moves (arrows, clicks) change which token is being typed,
            // so the open mention is recomputed off selection too.
            onSelect={(e) => syncMention(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && mention) {
                e.preventDefault();
                setMention(null);
                setMentionOrigin(null);
                return;
              }
              // IME GUARD: while an input method is composing (typing a CJK
              // name, picking from the candidate window), Enter COMMITS the
              // composition — it is not a submit. Without this, composing a
              // handle and pressing Enter sent the half-finished draft.
              // `keyCode === 229` is the legacy signal browsers still emit for
              // a composing keydown when `isComposing` is unset.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? "Message the channel"}
            spellCheck
            className="min-h-[calc(1.625em_+_8px)] max-h-[calc(4.875em_+_8px)] flex-1 resize-none overflow-y-auto bg-transparent py-1 text-body leading-relaxed text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
          />
          <SendButton
            onClick={() => void sendMessage()}
            disabled={!canSend}
            label="Send message"
          />
        </div>

        {/* The consequence, in one line, changing with the mode. This is the
            whole point of the toggle: the label says what you picked, this says
            what pressing Enter will DO. */}
        <p className="mt-1.5 text-caption text-text-muted">
          {composerModeHelp(mode, targetName, {
            mentionedHandles: mentionedAgents.map((a) => a.name),
            blocked: built.ok ? null : built.reason,
          })}
        </p>

        {/* The popup still only INSERTS TEXT, and that is the design: the send
            resolves `@handle` tokens out of the finished body, so a handle
            typed by hand, pasted, or picked here all mean the same thing, and a
            deleted one stops meaning anything. It never touches `toUserId` —
            reaching a PERSON is request mode's job. */}
        <MentionPopup
          anchor={mentionAnchor}
          candidates={mentionCandidates}
          onSelect={acceptMention}
          onClose={() => {
            setMention(null);
            setMentionOrigin(null);
          }}
        />
      </div>
    </div>
  );
}
