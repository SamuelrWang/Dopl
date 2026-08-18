/**
 * Channels v2 — the composer card, with the @-mention autocomplete floating
 * above its left edge and the NEW AGENT THREAD panel recessed inside it.
 *
 * The typed line and the open suggestion list are FIXTURE STATE, frozen mid
 * keystroke so the review can see both surfaces at once. Nothing types, nothing
 * sends.
 *
 * The one live interaction is the `Bot` toggle: it opens an inset panel above
 * the text area, which stays the thread's opening message — there is no second
 * textarea. The card is bottom-anchored in the pane, so the extra height reads
 * as the composer growing UPWARD.
 *
 * What a send WOULD do (drawn, not wired — the whole page is inert): the title
 * becomes the thread title, the pills become its addressees, and the request
 * lands in the channel as a thread card (`message-pane.tsx ›
 * ThreadRequestCard`). MAPPING.md § New agent thread has the lifecycle.
 */

import { useState } from "react";
import { AtSign, Bot, Expand, Mic, Paperclip, Smile, X, Zap } from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { FIELD_WELL } from "@/shared/ui/wells";
import { cn } from "@/shared/lib/utils";
import { AgentTargetPill, IconButton } from "./bits";
import { AGENT_TARGETS, MENTION_SUGGESTIONS } from "./mock-data";

export function ChannelsV2Composer() {
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [removedAgents, setRemovedAgents] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  // Re-opening resets the addressees to ALL. A request you dropped everyone
  // from is not a draft worth restoring — the next one starts whole.
  const toggleAgentPanel = () => {
    setAgentPanelOpen((open) => {
      if (open) return false;
      setRemovedAgents(new Set());
      return true;
    });
  };

  const removeAgent = (id: string) =>
    setRemovedAgents((prev) => new Set(prev).add(id));

  return (
    <div className="relative shrink-0 px-4 pb-4 pt-1">
      <MentionPopover />
      {/*
        The card itself carries NO row gap — the panel's own spacing rides
        inside the collapsing region, so a closed panel leaves no phantom gap
        above the text line. The two always-present rows keep their gap-2 in a
        wrapper of their own.
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
            agentPanelOpen
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          )}
        >
          <div className="overflow-hidden" inert={!agentPanelOpen}>
            <div className="pb-2">
              <AgentRequestPanel
                removed={removedAgents}
                onRemove={removeAgent}
                onDismiss={() => setAgentPanelOpen(false)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 py-1 text-lead text-text-primary">
              <span aria-hidden>💪💪 </span>
              <span className="font-medium text-link">@D</span>
              {/* Caret stand-in: the reference shows the composer mid-keystroke. */}
              <span
                aria-hidden
                className="ml-px inline-block h-[13px] w-px translate-y-0.5 bg-text-primary"
              />
            </p>
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
              className="rounded-[8px] px-2.5 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
            >
              Discard
            </button>
            <button
              type="button"
              className="auth-btn-3d ml-1 rounded-[8px] px-3.5 py-1.5 text-caption font-semibold text-text-on-cta"
            >
              Send
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
  removed,
  onRemove,
  onDismiss,
}: {
  removed: ReadonlySet<string>;
  onRemove: (id: string) => void;
  onDismiss: () => void;
}) {
  const addressed = AGENT_TARGETS.filter((target) => !removed.has(target.id));

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
        spellCheck={false}
        placeholder="Title — what is this thread about?"
        className={cn(
          FIELD_WELL,
          "h-8 w-full px-2.5 text-body text-text-primary placeholder:text-text-muted"
        )}
      />
    </div>
  );
}

function MentionPopover() {
  return (
    <div className="bento absolute bottom-[calc(100%-4px)] left-4 z-10 w-[220px] p-1.5">
      <p className="px-2 pb-1 pt-0.5 text-label font-semibold uppercase tracking-wide text-text-muted">
        Members
      </p>
      {MENTION_SUGGESTIONS.map(({ person, name, selected }) => (
        <div
          key={person.userId}
          className={cn(
            "flex h-8 items-center gap-2 rounded-[8px] px-2 text-small",
            selected
              ? "bg-surface-raised-3 font-medium text-text-primary"
              : "text-text-secondary"
          )}
        >
          <Avatar person={person} size="xs" className="h-[20px] w-[20px] text-micro" />
          <span className="truncate">{name}</span>
        </div>
      ))}
    </div>
  );
}
