"use client";

import { useMemo, useState } from "react";
import { Info, WifiOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useAutoGrowTextarea } from "@/shared/ui/auto-grow-textarea";
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
  applyMention,
  buildMentionCandidates,
  findMentionQuery,
  mentionPopupHeight,
  type MentionCandidate,
  type MentionQuery,
} from "../lib/mention";
import { AddressPicker } from "./address-picker";
import { MentionPopup, SlashCommandHint } from "./mention-popup";

/** Placeholder + accessible name for the optional one-liner that rides with an
 *  addressed send (the wire field is still `summary`). */
const SUBJECT_LABEL = "Subject";

export interface SendOptions {
  toUserId?: string;
  summary?: string;
}

interface Props {
  /** Resolve when the send settles; a rejection keeps the text for retry. */
  onSend: (body: string, opts?: SendOptions) => Promise<void>;
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
   * one to pick: the addressing row is hidden and every human send auto-targets
   * that peer (`toUserId = peer`).
   */
  isDirect?: boolean;
}

/**
 * Resolve the addressing options for a human send. Pure so the addressing
 * model (DM auto-targets the peer; a channel send carries the picked addressee;
 * an unaddressed channel send targets no one) is unit-testable without a DOM.
 *
 * - Direct channel: always addresses the resolved peer; the summary is the
 *   optional one-liner (undefined when blank).
 * - Channel with a picked addressee: addresses them; the summary is the
 *   one-liner, or the first line of the body as an implicit intent.
 * - Channel with no addressee: no options (the message reaches no agent).
 */
export function resolveSendOptions(params: {
  isDirect: boolean;
  peerId: string | null;
  toUserId: string | null;
  summary: string;
  body: string;
}): SendOptions | undefined {
  const { isDirect, peerId, toUserId, summary, body } = params;
  const trimmedSummary = summary.trim();
  if (isDirect) {
    return peerId
      ? { toUserId: peerId, summary: trimmedSummary || undefined }
      : undefined;
  }
  if (toUserId) {
    return {
      toUserId,
      summary: trimmedSummary || body.split("\n")[0].slice(0, 200),
    };
  }
  return undefined;
}

/**
 * What a submitted draft DID: summoned an agent, or posted a message.
 *
 * The decision lives here, pure, because it is the one place a keystroke stops
 * being chat: a draft that parses as `/new-agent` calls the create mutation and
 * NEVER posts, so a mistyped command can't leak into the transcript as text
 * while also creating an agent. Anything else — prose, an unknown command, a
 * slash mid-sentence — posts exactly as it did before.
 *
 * `onCreateAgent` absent means the surface has no create path wired, in which
 * case the command posts as ordinary text rather than being silently dropped.
 */
export async function performComposerSubmit(params: {
  /** The trimmed draft. */
  body: string;
  isDirect: boolean;
  peerId: string | null;
  toUserId: string | null;
  summary: string;
  onSend: (body: string, opts?: SendOptions) => Promise<void>;
  onCreateAgent?: (name?: string) => Promise<unknown>;
}): Promise<"created" | "sent"> {
  const { body, onSend, onCreateAgent } = params;
  const command = parseSlashCommand(body);
  if (command?.name === NEW_AGENT_COMMAND && onCreateAgent) {
    await onCreateAgent(command.arg ?? undefined);
    return "created";
  }
  await onSend(
    body,
    resolveSendOptions({
      isDirect: params.isDirect,
      peerId: params.peerId,
      toUserId: params.toUserId,
      summary: params.summary,
      body,
    })
  );
  return "sent";
}

/**
 * Message composer pinned to the bottom of the thread. One unified input: a
 * concave-field well with an auto-submitting textarea (Enter sends, Shift+Enter
 * adds a newline) that AUTO-GROWS to three lines and then scrolls, exactly like
 * the desktop session window's composer, plus the shared `SendButton` (the same
 * raised black circle both surfaces use). Above the well, an optional addressing
 * row targets one teammate's agent (`toUserId`) with an optional Subject
 * (`summary` on the wire); in a DM the peer is implicit, so only the Subject
 * field shows.
 *
 * A human send ALWAYS posts a message. Opening a thread is no longer a human
 * toggle — it is agent-driven (an agent calls `create_thread` over MCP), and the
 * web still renders any resulting threads with their cards / milestones /
 * receipts.
 *
 * In a DM every human send auto-addresses the peer. In a channel of
 * `GROUP_CHANNEL_MIN_MEMBERS` or more, an UNADDRESSED message triggers no agent
 * at all (the targeting rule only implies a recipient in a two-person channel),
 * so the composer says so rather than letting the message land silently. That
 * hint is the ONE place the web surface tells the truth about group routing;
 * the invite dialog states the same rule where the member count crosses it.
 */
export function MessageComposer({
  onSend,
  disabled,
  placeholder,
  members,
  currentUserId,
  isDirect,
  agents,
  onCreateAgent,
}: Props) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [toUserId, setToUserId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  // The `@…` token under the caret, plus the input's measured top-left corner
  // (the list opens UPWARD from it). Both are cleared on send, on dismiss, and
  // whenever the token stops being a mention.
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [mentionOrigin, setMentionOrigin] = useState<
    { x: number; y: number } | null
  >(null);
  // Grows with the typed lines up to three, then scrolls (shared with the
  // session window's D7 math). Keyed on `value`, so clearing after a send snaps
  // the field back to one line.
  const textareaRef = useAutoGrowTextarea(value);

  // The peer of a direct channel is the one other member; every DM send
  // auto-targets it, so a stale picked addressee can never color a direct send.
  const peerId = useMemo(
    () =>
      isDirect
        ? members.find((m) => m.userId !== currentUserId)?.userId ?? null
        : null,
    [isDirect, members, currentUserId]
  );

  // The agent a send actually reaches: the DM peer, else the picked addressee.
  // Null in a channel is NOT a broadcast — an unaddressed message is delivered
  // to the transcript and picked up by no agent (see the hint below).
  const resolvedTargetId = isDirect ? peerId : toUserId;
  const target = useMemo(
    () =>
      resolvedTargetId
        ? members.find((m) => m.userId === resolvedTargetId) ?? null
        : null,
    [resolvedTargetId, members]
  );

  const canSendMessage = value.trim().length > 0 && !sending && !disabled;

  // Two members = the other one is the implicit target, so an unaddressed
  // message still reaches an agent. Three or more and it reaches none. A DM
  // never shows this (it always has an implicit peer). An unloaded roster is
  // length 0, so the hint is absent rather than wrong while members resolve.
  const showUnaddressedHint =
    !isDirect && !toUserId && members.length >= GROUP_CHANNEL_MIN_MEMBERS;

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

  async function sendMessage() {
    if (!canSendMessage) return;
    const body = value.trim();
    setSending(true);
    try {
      await performComposerSubmit({
        body,
        isDirect: Boolean(isDirect),
        peerId,
        toUserId,
        summary,
        onSend,
        onCreateAgent,
      });
      setValue("");
      setSummary("");
      setToUserId(null);
      setMention(null);
      setMentionOrigin(null);
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
                placeholder={SUBJECT_LABEL}
                aria-label={SUBJECT_LABEL}
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
            placeholder={SUBJECT_LABEL}
            aria-label={SUBJECT_LABEL}
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
            disabled={!canSendMessage}
            label="Send message"
          />
        </div>

        {/* v1: the accepted mention is TEXT for humans and agents to read. It
            deliberately does NOT touch `toUserId` — server-side `@handle`
            addressing lands in a later lane. */}
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
