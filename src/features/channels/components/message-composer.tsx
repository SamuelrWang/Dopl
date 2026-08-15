"use client";

import { useMemo, useState } from "react";
import { Info, WifiOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useAutoGrowTextarea } from "@/shared/ui/auto-grow-textarea";
import { SendButton } from "@/shared/ui/send-button";
import { FIELD_WELL } from "@/shared/ui/wells";
import { GROUP_CHANNEL_MIN_MEMBERS } from "../constants";
import type { ChannelMember } from "../types";
import {
  buildComposerPayload,
  composerModeHelp,
  DEFAULT_COMPOSER_MODE,
  resolveRequestTarget,
  submitComposerDraft,
  type ComposerMode,
  type SendOptions,
} from "../lib/composer-mode";
import { AddressPicker } from "./address-picker";
import { ComposerIntentPill } from "./composer-intent-pill";

/** Placeholder + accessible name for the request's title (wire field: `title`). */
const SUBJECT_LABEL = "Subject";

/** ⚠ Re-exported from the pill that owns it, so the one accessible name has ONE
 *  definition and existing consumers keep their import. */
export { COMPOSER_MODE_LABEL } from "./composer-intent-pill";

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
  /** ⚠ True while `members` still belongs to the PREVIOUS channel. REQUEST mode
   *  turns this roster into the wire `toUserId`, so a request built now
   *  addresses a non-member — Send is disabled and says why, rather than posting
   *  and rolling back on a 400. */
  membersStale?: boolean;
  currentUserId: string;
  /** Direct channel: one peer, so request mode auto-targets it and the picker
   *  is hidden. */
  isDirect?: boolean;
}

/**
 * Message composer pinned to the bottom of the channel. One unified input: a
 * concave-field well with an auto-submitting textarea (Enter sends, Shift+Enter
 * newlines) that AUTO-GROWS to three lines then scrolls, matching the desktop
 * thread window's composer, plus the shared `SendButton`.
 *
 * Two modes, chosen on a PILL INSIDE THE INPUT:
 * - MESSAGE (default; `intent: "chat"` on the wire) — plain channel message. No
 *   subject, thread or addressee; reaches nobody's machine, and the line under
 *   the composer says so. ⚠ `@` resolves to nothing: no picker, no command lane.
 * - REQUEST — subject field returns and an addressee is required. Sending opens
 *   a THREAD through the create-thread path (title = subject, body =
 *   starts that member's agent.
 *
 * WHERE THE CHROME SITS, and why it moved. The mode control is now `ComposerIntentPill`,
 * inside the concave input bubble beside the send button — one of §3.2's two
 * pills, the other being the session window's. What is left in the row ABOVE the
 * input is REQUEST-ONLY (the addressee picker and the subject), so the resting
 * composer is now a single input with two controls in it and nothing else: the
 * cheapest state is the quietest one on screen too.
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
  membersStale,
  currentUserId,
  isDirect,
}: Props) {
  const [mode, setMode] = useState<ComposerMode>(DEFAULT_COMPOSER_MODE);
  const [value, setValue] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [toUserId, setToUserId] = useState<string | null>(null);
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
    rosterStale: Boolean(membersStale),
  };

  // Who a REQUEST would reach. Null in chat mode's rendering too, because a
  // chat send has no target by construction — and null while the roster is
  // stale, because the person it would name is the last channel's peer.
  const targetId =
    mode === "request" && !membersStale ? resolveRequestTarget(draft) : null;
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

  // Built ONCE and read twice: the send button needs the boolean, the help line
  // needs the REASON. Reading only the boolean is how a request with no subject
  // greyed out the button while the line still promised to start someone's agent.
  const built = buildComposerPayload(draft);
  const canSend = built.ok && !sending && !disabled;

  // The old N-party warning, narrowed: chat mode reaching no agent is now the
  // POINT, so the hint would be noise there. It fires only where an operator
  // still expects a pickup and won't get one — request mode, group channel, no
  // addressee picked. An unloaded roster is length 0, so the hint is absent
  // rather than wrong while members resolve; a STALE one is the previous
  // channel's and would count the wrong people, so it waits too.
  const showUnaddressedHint =
    mode === "request" &&
    !isDirect &&
    !membersStale &&
    !toUserId &&
    members.length >= GROUP_CHANNEL_MIN_MEMBERS;

  /**
   * Put a draft back ONLY if the field is still empty.
   *
   * The mirror of the old `clearIfUnchanged`, and it exists for the same
   * reason turned inside out. Clearing used to happen AFTER the await, so an
   * unconditional `setValue("")` destroyed whatever the operator typed while
   * the request was in flight. Clearing now happens BEFORE it (the message is
   * already on screen as a pending row, so the draft has somewhere to be), and
   * the only write that can clobber a fresh draft is the FAILURE restore — so
   * that is the one guarded now.
   */
  function restoreIfEmpty(
    set: (updater: (current: string) => string) => void,
    sent: string
  ) {
    set((current) => (current === "" ? sent : current));
  }

  async function sendMessage() {
    if (!canSend) return;
    const submitted = draft;
    const sentTo = toUserId;
    setSending(true);
    // CLEAR SYNCHRONOUSLY, before the request leaves. This is half of the
    // optimistic send: the caller has already written a pending row into the
    // transcript cache, so the text is not lost by being taken out of the
    // field — it has moved from a draft to a message. Waiting for the round
    // trip is what made the operator's own words sit in the composer through
    // two network hops while a 30px button dimmed.
    setValue("");
    setSubject("");
    setToUserId(null);
    let failed = false;
    try {
      const result = await submitComposerDraft({
        ...submitted,
        onSend,
        onCreateThread,
      });
      failed = result === "blocked";
    } catch {
      // The caller has already toasted the reason and rolled its cache back,
      // so the draft belongs in the field again for a retry.
      failed = true;
    } finally {
      setSending(false);
    }
    if (!failed) return;
    restoreIfEmpty(setValue, submitted.body);
    restoreIfEmpty(setSubject, submitted.subject);
    setToUserId((current) => current ?? sentTo);
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
        {/* REQUEST-ONLY CHROME. The whole row is gone in message mode now that
            the pill left it: a chat message has no addressee and no subject, so
            an empty row above the input was pure furniture. A DM's peer is
            implicit, so it shows no picker either. */}
        {mode === "request" && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {/* The picker waits out a stale roster too, and not only for
                cosmetics: a name picked from the PREVIOUS channel's list would
                still be sitting in `toUserId` when the real roster lands and
                the send gate opens — which is the same 400 arriving a second
                later. There is nothing to pick from until the roster is this
                channel's. */}
            {!isDirect && !membersStale && (
              <AddressPicker
                members={members}
                currentUserId={currentUserId}
                value={toUserId}
                onChange={setToUserId}
              />
            )}
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
          </div>
        )}

        {offlineHint}

        {showUnaddressedHint && (
          <div className="mb-2 flex items-center gap-1.5 text-caption text-text-muted">
            <Info size={12} className="shrink-0" />
            No agent will pick this up unless you address it.
          </div>
        )}

        <div className="concave-field flex items-end gap-2 rounded-[12px] px-3 py-2">
          {/* rows=1 + the min/max heights keep CSS and the growHeight() math in
              agreement: one line at rest, three lines then scroll. The inline
              height the hook sets rides inside that clamp. leading-relaxed is
              1.625em per line, py-1 is 8px of vertical padding. */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
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
          {/* §3.2: the pill lives INSIDE the bubble, to the left of send. It is
              LOCKED WHILE SENDING for the same reason the text is no longer
              clobbered — the mode decides what the in-flight request WAS, so
              flipping it mid-send left the line below describing a consequence
              that no longer matched anything. */}
          <ComposerIntentPill mode={mode} onChange={setMode} disabled={sending} />
          {/* THE BUTTON MORPHS while the write is in flight. `SendButton` has
              carried a `mode="pause"` face since it was extracted from the
              desktop session window and no composer ever passed it: the send
              path's only feedback was this same button at 50% opacity. The
              draft is already gone from the field and the message is already
              in the transcript by the time this renders, so the pause face is
              the honest statement of the one thing still outstanding — the
              round trip. It stays disabled because nothing in the web app can
              interrupt a turn yet; the glyph is the signal, not the target. */}
          <SendButton
            mode={sending ? "pause" : "send"}
            onClick={() => void sendMessage()}
            disabled={!canSend}
            label={sending ? "Sending" : "Send message"}
          />
        </div>

        {/* The consequence, in one line, changing with the mode. This is the
            whole point of the toggle: the label says what you picked, this says
            what pressing Enter will DO. */}
        <p className="mt-1.5 text-caption text-text-muted">
          {composerModeHelp(mode, targetName, {
            blocked: built.ok ? null : built.reason,
          })}
        </p>
      </div>
    </div>
  );
}
