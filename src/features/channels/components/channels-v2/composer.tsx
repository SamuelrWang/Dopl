"use client";

/**
 * Channels v2 — the composer card, with the @-mention autocomplete floating
 * above its left edge and the NEW AGENT THREAD panel recessed inside it.
 *
 * ⚠ TWO SENDS, ONE BUTTON, AND THEY ARE DIFFERENT WRITES. With the panel CLOSED
 * Send posts a plain chat message (`intent:"chat"` — the wire value is
 * load-bearing, it is what tells the receiving side this reaches nobody's
 * agent). With the panel OPEN it raises a REQUEST: the title becomes the thread
 * title, every remaining pill becomes an addressee, and the fan-out writes one
 * `channel_tasks` row per pill (INVARIANTS §5 — a thread is one requester + one
 * target) which the transcript renders as ONE card
 * (`transcript.tsx › ThreadCardMessage`).
 *
 * ⚠ N PILLS = N ADDRESSEES, AND ZERO PILLS IS NOT SENDABLE. "Broadcast" is not
 * a shape this product has. The button disables at zero as a courtesy; the
 * CONTRACT is `schema.ts › TaskFanOutSchema`, where an empty addressee list is
 * a 400 — a UI-only refusal would be a rule that exists until somebody writes a
 * second client.
 *
 * ⚠ THE BASE IDEMPOTENCY KEY IS MINTED HERE, at submit, exactly once per Send.
 * The server derives one key per addressee from it plus the group id the card
 * is drawn from, so a retry converges thread-by-thread instead of raising the
 * request twice (INVARIANTS §8).
 */

import { useMemo, useState } from "react";
import { AtSign, Bot, Expand, Mic, Paperclip, Smile, X, Zap } from "lucide-react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { Avatar } from "@/shared/ui/avatar";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { FIELD_WELL } from "@/shared/ui/wells";
import { cn } from "@/shared/lib/utils";
import { AgentTargetPill, IconButton } from "./bits";
import { agentLabel } from "./fixtures";
import { memberLabel } from "../../lib/channel-display";
import { useThreadWrites } from "../../hooks/use-thread-writes";
import { newClientMsgId } from "../../lib/optimistic-cache";
import { memberPerson } from "./view-model";
import type { ChannelMember } from "../../types";

/**
 * Why Send is disabled, said out loud. ⚠ A disabled control with no reason is
 * indistinguishable from a broken one.
 */
function sendHint(panelOpen: boolean, canSend: boolean, pending: boolean): string {
  if (canSend) return panelOpen ? "Send request" : "Send";
  if (pending) return "Sending…";
  if (!panelOpen) return "Write a message first";
  return "A request needs a title and at least one agent";
}

/** The trailing `@token` of a draft, or null when the caret is not in one. */
function mentionQuery(draft: string): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(draft);
  return match ? match[1].toLowerCase() : null;
}

export function ChannelsV2Composer({
  channelId,
  workspaceId,
  members,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  gate,
}: {
  /** ⚠ CAPTURED AT SUBMIT into every draft — never re-read from the selection
   *  while a write is in flight (INVARIANTS §8, rule 4). */
  channelId: string;
  workspaceId: string;
  members: ChannelMember[];
  currentUserId: string;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  /** The page's refetch coordinator — the SAME gate the reads register. */
  gate: MutationGate;
}) {
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [removedAgents, setRemovedAgents] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const { send, fanOutThreads, pending } = useThreadWrites({
    workspaceId,
    currentUserId,
    currentUserName,
    currentUserAvatarUrl,
    gate,
  });

  // Every OTHER member's agent. Derived from the REAL roster, so the pills and
  // the Info tab's members list cannot disagree — you do not address your own.
  const targets = useMemo(
    () =>
      members
        .filter((m) => m.userId !== currentUserId)
        .map((m) => ({ id: m.userId, label: agentLabel(m.displayName ?? m.email) })),
    [members, currentUserId]
  );

  const query = mentionQuery(draft);
  const suggestions = useMemo(() => {
    if (query === null) return [];
    return members
      .filter((m) => memberLabel(m).toLowerCase().includes(query))
      .slice(0, 5);
  }, [members, query]);

  // Re-opening resets the addressees to ALL. A request you dropped everyone
  // from is not a draft worth restoring — the next one starts whole.
  const toggleAgentPanel = () => {
    setAgentPanelOpen((open) => {
      if (open) return false;
      setRemovedAgents(new Set());
      return true;
    });
  };

  const addressed = targets.filter((target) => !removedAgents.has(target.id));
  const body = draft.trim();
  // ⚠ THE SEND GATE, computed once and read twice — the button's `disabled` and
  // the submit's own guard. A request additionally needs a title and at least
  // one addressee; a chat message needs a body and nothing else.
  const canSend =
    body.length > 0 &&
    !pending &&
    (!agentPanelOpen || (title.trim().length > 0 && addressed.length > 0));

  const clear = () => {
    setDraft("");
    setTitle("");
    setAgentPanelOpen(false);
  };

  /**
   * ⚠ THE COMPOSER CLEARS BEFORE THE AWAIT and the drafts carry everything the
   * write needs — the optimistic layer owns the rollback, and re-reading state
   * after the round trip would read a composer the user has since typed into.
   */
  const submit = () => {
    if (!canSend) return;
    if (agentPanelOpen) {
      const request = {
        channelId,
        clientMsgId: newClientMsgId(),
        title: title.trim(),
        body,
        toUserIds: addressed.map((target) => target.id),
      };
      clear();
      fanOutThreads.mutate(request);
      return;
    }
    const message = {
      channelId,
      clientMsgId: newClientMsgId(),
      body,
      // ⚠ EXPLICIT, never omitted. Absence reads as `request` on the wire
      // (`schema.ts › MessageIntentSchema`), and the plain composer is human
      // chat, full stop — the intent pill that used to choose is retired.
      intent: "chat" as const,
    };
    clear();
    send.mutate(message);
  };

  return (
    <div className="relative shrink-0 px-4 pb-4 pt-1">
      {suggestions.length > 0 && <MentionPopover members={suggestions} />}
      {/*
        The card itself carries NO row gap — the panel's own spacing rides
        inside the collapsing region, so a closed panel leaves no phantom gap
        above the text line.
      */}
      <div className="bento flex flex-col px-3 py-2.5">
        {/*
          Height animates through the grid-rows 0fr→1fr idiom rather than a
          measured pixel height: the panel's own content decides how far the
          card grows, and no layout number is hardcoded. `motion-reduce` snaps.
        */}
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
            agentPanelOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          )}
        >
          <div className="overflow-hidden" inert={!agentPanelOpen}>
            <div className="pb-2">
              <AgentRequestPanel
                targets={targets}
                removed={removedAgents}
                title={title}
                onTitleChange={setTitle}
                onRemove={(id) =>
                  setRemovedAgents((prev) => new Set(prev).add(id))
                }
                onDismiss={() => setAgentPanelOpen(false)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line — and an IME
                // composition never sends, or a mid-word confirm posts.
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) {
                  return;
                }
                e.preventDefault();
                submit();
              }}
              rows={1}
              spellCheck={false}
              aria-label="Message"
              placeholder={
                agentPanelOpen ? "Describe the request" : "Write a message"
              }
              className="min-w-0 flex-1 resize-none bg-transparent py-1 text-lead text-text-primary outline-none placeholder:text-text-muted"
            />
            <IconButton icon={Expand} label="Expand composer" size={14} className="h-6 w-6" />
          </div>

          <div className="flex items-center gap-0.5">
            <IconButton
              icon={Bot}
              label="New agent thread"
              size={15}
              className="h-6 w-6"
              active={agentPanelOpen}
              onClick={toggleAgentPanel}
            />
            <IconButton icon={AtSign} label="Mention" size={15} className="h-6 w-6" />
            <IconButton icon={Zap} label="Shortcuts" size={15} className="h-6 w-6" />
            <IconButton icon={Smile} label="Emoji" size={15} className="h-6 w-6" />
            <IconButton icon={Paperclip} label="Attach file" size={15} className="h-6 w-6" />
            <IconButton icon={Mic} label="Record audio" size={15} className="h-6 w-6" />
            <span className="flex-1" />
            <button
              type="button"
              onClick={clear}
              className="rounded-[8px] px-2.5 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
            >
              Discard
            </button>
            {/* ⚠ DISABLED WITH A REASON, never a silent no-op: a Send that
                swallows the click is a surface claiming to have sent something
                it did not (INVARIANTS §8, rule 4 — the gate says WHY). */}
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              title={sendHint(agentPanelOpen, canSend, pending)}
              className={cn(
                "auth-btn-3d ml-1 rounded-[8px] px-3.5 py-1.5 text-caption font-semibold text-text-on-cta",
                !canSend && "cursor-not-allowed opacity-60"
              )}
            >
              {agentPanelOpen ? "Send request" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The recessed new-thread panel. Body is the kit's concave section face
 * (`SECTION_BOX_INSET`) so it reads as pressed INTO the composer card; the
 * pills are the raised `CHIP` that face is written to carry, and the title is
 * the concave `FIELD_WELL` — a second, deeper well inside the first.
 */
function AgentRequestPanel({
  targets,
  removed,
  title,
  onTitleChange,
  onRemove,
  onDismiss,
}: {
  targets: Array<{ id: string; label: string }>;
  removed: ReadonlySet<string>;
  title: string;
  onTitleChange: (next: string) => void;
  onRemove: (id: string) => void;
  onDismiss: () => void;
}) {
  const addressed = targets.filter((target) => !removed.has(target.id));

  return (
    <div className={cn(SECTION_BOX_INSET, "flex flex-col gap-2 rounded-[10px] p-2.5")}>
      <div className="flex items-center gap-2">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          New agent thread
        </span>
        <span className="flex-1" />
        <IconButton
          icon={X}
          label="Close new agent thread"
          size={13}
          className="h-5 w-5"
          onClick={onDismiss}
        />
      </div>

      {addressed.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {addressed.map((target) => (
            <AgentTargetPill
              key={target.id}
              label={target.label}
              onRemove={() => onRemove(target.id)}
            />
          ))}
        </div>
      ) : (
        // Fail-closed, said out loud: with nobody addressed there is no
        // thread. "Everyone" is not a shape this product has (INVARIANTS §5).
        <p className="py-1 text-caption text-text-muted">
          No agent addressed — this thread reaches nobody.
        </p>
      )}

      <input
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        spellCheck={false}
        aria-label="Thread title"
        placeholder="Title — what is this thread about?"
        className={cn(
          FIELD_WELL,
          "h-8 w-full px-2.5 text-body text-text-primary placeholder:text-text-muted"
        )}
      />
    </div>
  );
}

/** Roster-resolved @-mention candidates for the token being typed. */
function MentionPopover({ members }: { members: ChannelMember[] }) {
  return (
    <div className="bento absolute bottom-[calc(100%-4px)] left-4 z-10 w-[220px] p-1.5">
      <p className="px-2 pb-1 pt-0.5 text-label font-semibold uppercase tracking-wide text-text-muted">
        Members
      </p>
      {members.map((member, i) => (
        <div
          key={member.userId}
          className={cn(
            "flex h-8 items-center gap-2 rounded-[8px] px-2 text-small",
            i === 0
              ? "bg-surface-raised-3 font-medium text-text-primary"
              : "text-text-secondary"
          )}
        >
          <Avatar
            person={memberPerson(member)}
            size="xs"
            className="h-[20px] w-[20px] text-micro"
          />
          <span className="truncate">{memberLabel(member)}</span>
        </div>
      ))}
    </div>
  );
}
