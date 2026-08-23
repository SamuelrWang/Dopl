"use client";

/**
 * Channels v2 — the right panel's AGENTS tab: MY agents running in this
 * channel, one card each, each with a way into the agent view.
 *
 * ⚠ WIRED (wiring plan Phase 5, 2026-08-18). `fixtures-agents.ts` is DELETED.
 * Every card is one live entry from this machine's own session projection —
 * `agents-model.ts`, over `spa-bridge.ts › DesktopSessionSummary` — including
 * the context and token numbers, which the desktop measures and the server
 * stores none of (INVARIANTS §5's Agents-tab bullet; the ruling arrived in the
 * port's intent doc, deleted at the Phase 12 cutover).
 *
 * It is an OPERATOR surface, not a roster, and that is structural: the feed IS
 * one machine's own registry, so another member's agent cannot appear here.
 * The Info tab's Members list is where everyone's presence lives.
 *
 * ⚠ DESKTOP-ONLY, AND IT SAYS SO RATHER THAN SHOWING NOTHING. In a plain
 * browser (or on a desktop older than the feed) there is no local runtime to
 * read, so the tab states that reality — "could not ask" and "asked, nothing is
 * running" are different facts and are worded differently. An empty list under
 * a browser would read as "you have no agents", which is a claim this surface
 * cannot make.
 *
 * An operator can be running several agents at once, and more than one of them
 * on the SAME thread — the cards are grouped so that reads off the column
 * instead of having to be inferred.
 *
 * ⚠ COPY RULE (INVARIANTS §5): inside one member's window there is exactly ONE
 * session, so it never needs a qualifier. Nothing here writes "agent session"
 * or "channel session" — the noun on this surface is the AGENT.
 */

import { useMemo } from "react";
import { ChevronDown, Plus } from "lucide-react";
import {
  TemplateLaunchPicker,
  useTemplatePicker,
} from "@/features/agent-templates/components/template-picker";
import type { TemplateLaunchOverrides } from "@/features/agent-templates/lib/launch-overrides";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import type { ChannelMember } from "../../types";
import { AgentCard, PeerCards } from "./agents-tab-cards";
import {
  agentKey,
  agentsPerThread,
  ownAgentsFor,
  peerCardsFor,
} from "./agents-model";
import type { AgentLaunchOutcome } from "./use-agents-panel";


export function AgentsTab({
  sessions,
  channelId,
  workspaceId = null,
  openThreadId = null,
  members = [],
  currentUserId = null,
  peers = [],
  canLaunch = false,
  launchBusy = false,
  launchError = null,
  onLaunchAgent,
  onApproveTemplate,
  openAgent,
  onOpenAgent,
}: {
  /** The whole machine's feed, or `null` for "could not ask" — no bridge, or a
   *  main without it. ⚠ Never collapse `null` into `[]` on the way in. */
  sessions: readonly DesktopSessionSummary[] | null;
  channelId: string;
  /** THE TEMPLATE PICKER'S ONE INPUT. ⚠ Absent ⇒ NO CHEVRON, and the New Agent
   *  button is exactly what it was — the same feature-detected degradation every
   *  bridge affordance in this family follows, applied to a READ instead of an
   *  op (a picker with no workspace to list is a control that can only be
   *  empty). */
  workspaceId?: string | null;
  /** The OPEN thread (2026-08-20): scopes the tab — thread view shows that
   *  thread's agents alone; channel view shows the whole channel's. */
  openThreadId?: string | null;
  /** The roster, for the owner avatar every card wears. */
  members?: ChannelMember[];
  currentUserId?: string | null;
  /** EVERY member's session STATE for this channel (the server projection) —
   *  peers render as state-only cards, never openable. */
  peers?: readonly ChannelPeerSession[];
  /** The New Agent button (thread view only; desktop only). */
  canLaunch?: boolean;
  launchBusy?: boolean;
  /** Copy for the last launch main REFUSED, or null. ⚠ A refusal is not a
   *  push — nothing announces it, so the button's own row is the only place it
   *  can be said (`use-agents-panel.ts › launchRefusalText`). */
  launchError?: string | null;
  /**
   * ⚠ THE ZERO-TEMPLATE CALL IS THE PINNED ONE. `onLaunchAgent(threadId)` is
   * still what the New Agent button does in ONE CLICK, and the two optional
   * arguments exist for the picker beside it (Samuel's "one lane, one-click
   * launch" ruling — the picker never intercepts the button).
   */
  onLaunchAgent?: (
    threadId: string,
    templateId?: string | null,
    overrides?: TemplateLaunchOverrides
  ) => Promise<AgentLaunchOutcome> | void;
  /** Store a first-use approval for another member's template, machine-locally.
   *  ⚠ Absent ⇒ the approval modal says the build cannot remember it, rather
   *  than looping on a refusal it can never clear. */
  onApproveTemplate?: (templateId: string) => Promise<{ ok: boolean; reason?: string }>;
  /** `agentKey(session)` of the open agent view, or null. */
  openAgent: string | null;
  onOpenAgent: (key: string) => void;
}) {
  const byUser = new Map(members.map((m) => [m.userId, m]));
  const me = currentUserId ? (byUser.get(currentUserId) ?? null) : null;
  // ⚠ CALLED UNCONDITIONALLY, ABOVE EVERY EARLY RETURN. The tab bails out for a
  // browser (`sessions === null`) further down, and a hook behind that branch is
  // a hook-order violation on the very first desktop render.
  const picker = useTemplatePicker();
  // `userId → name` for the picker's authorship marker. ⚠ THE CHANNEL ROSTER,
  // which is not the workspace's — a template shared by someone outside this
  // channel resolves to no name and the marker degrades to "by another member"
  // rather than disappearing (`template-picker.tsx › authorMarker`).
  const memberNames = useMemo(
    () =>
      new Map(
        members.map((m) => [m.userId, m.displayName || m.email || ""] as const)
      ),
    [members]
  );

  /**
   * The picker's launch, adapted from the flat prop the tab already takes.
   *
   * ⚠ IT NEVER INVENTS A SUCCESS. A caller that hands down a void-returning
   * `onLaunchAgent` (an older mount, a test double) leaves the picker with
   * nothing to read, and reporting that as `{ ok: true }` would swallow a
   * refusal — this whole family's oldest bug. `no-bridge` is the honest answer
   * and it already has copy.
   */
  async function launchFromPicker(
    threadId: string,
    templateId: string | null,
    overrides?: TemplateLaunchOverrides
  ): Promise<AgentLaunchOutcome> {
    const res = await onLaunchAgent?.(threadId, templateId, overrides);
    return res ?? { ok: false, reason: "no-bridge" };
  }
  // Peers: other members' live rows, thread-scoped like everything on the tab.
  // Own rows are excluded — the LOCAL feed below is the richer truth for mine.
  // ⚠ THE PREDICATE IS `agents-model.ts › peerCardsFor`, NOT AN INLINE FILTER
  // (2026-08-20): the tab-row badge counts the same rows this list draws, and a
  // second copy of the rule is how a badge comes to say 3 over a list of 2.
  const peerCards = peerCardsFor(peers, currentUserId, openThreadId);

  // \u26a0 NEW AGENT, AND IT IS A REPEATABLE ACTION (Samuel, 2026-08-21). Every click
  // mints a NEW instance on this thread \u2014 the bridge no longer keeps one session
  // per (channel, thread) \u2014 so the button does NOT disarm once an agent exists.
  // The only two things that take it away are the capability being absent
  // (`canLaunch`) and a launch already in flight, which is a double-submit guard
  // and not a cap.
  //
  // \u26a0 IT IS A SPLIT BUTTON SINCE 2026-08-22, AND THE LEFT HALF IS UNCHANGED
  // (Samuel: *one lane, one-click launch*). The face still launches a BLANK agent
  // in exactly ONE CLICK with a byte-identical payload; the picker lives behind
  // an ADJACENT, visually attached chevron that is its own hit target. A popover
  // in front of the face would put a keystroke on the most common action in the
  // product, which is what the spec's OQ-4 proposed and this ruling refused.
  const launchRow = canLaunch && openThreadId && onLaunchAgent && (
    <div className="mb-3">
      <div className="flex items-stretch overflow-hidden rounded-[10px] border border-dashed border-border-strong">
        <button
          type="button"
          disabled={launchBusy}
          onClick={() => void onLaunchAgent(openThreadId)}
          className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-3 py-2 text-caption font-medium text-text-primary transition-colors hover:bg-card-surface-subtle disabled:opacity-60"
        >
          <Plus size={13} aria-hidden />
          {launchBusy ? "Starting\u2026" : "New Agent"}
        </button>
        {workspaceId && (
          <>
            {/* The hairline is what makes the pair read as ONE control with two
                zones rather than two buttons that happen to touch. */}
            <span aria-hidden className="w-px shrink-0 self-stretch bg-border-strong" />
            <button
              type="button"
              disabled={launchBusy}
              onClick={(e) => picker.toggleFrom(e.currentTarget)}
              aria-haspopup="menu"
              aria-expanded={picker.open}
              // \u26a0 ITS OWN NAME, never "New Agent". Two controls sharing an
              // accessible name is one control as far as a screen reader is
              // concerned, and the whole point of the split is that they are two.
              aria-label="Launch from template"
              // w-8 = 32px, comfortably over the 24px floor Samuel set for this
              // zone. A 4px sliver would hide the feature behind a dare.
              className="flex w-8 shrink-0 items-center justify-center text-text-secondary transition-colors hover:bg-card-surface-subtle hover:text-text-primary disabled:opacity-60"
            >
              <ChevronDown size={13} aria-hidden />
            </button>
          </>
        )}
      </div>
      {launchError && (
        <p role="alert" className="mt-1.5 px-0.5 text-caption text-danger">
          {launchError}
        </p>
      )}
      {workspaceId && (
        <TemplateLaunchPicker
          open={picker.open}
          at={picker.at}
          onClose={picker.close}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          memberNames={memberNames}
          busy={launchBusy}
          launch={(templateId, overrides) =>
            launchFromPicker(openThreadId, templateId, overrides)
          }
          approve={onApproveTemplate}
        />
      )}
    </div>
  );

  if (sessions === null) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
        {peerCards.length > 0 && <PeerCards peers={peerCards} byUser={byUser} />}
        <p className="px-0.5 py-6 text-center text-caption text-text-muted">
          Your agents run on your own machine, so this list needs the Dopl
          desktop app. Nothing about them is stored on the server.
        </p>
      </div>
    );
  }

  // ⚠ Same one-derivation rule as `peerCards` above — `ownAgentsFor` is what the
  // tab row's badge counts, so the list and the number are one function.
  const mine = ownAgentsFor(sessions, channelId, openThreadId);
  const perThread = agentsPerThread(mine);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
      {launchRow}
      <p className="pb-3 text-caption text-text-muted">
        {openThreadId
          ? "Agents on this thread. Yours first."
          : "Agents in this channel. Yours first."}
      </p>
      {mine.length === 0 && peerCards.length === 0 ? (
        <p className="py-6 text-center text-caption text-text-muted">
          {openThreadId
            ? "No agents on this thread yet."
            : "No agents running in this channel."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {mine.map((agent) => (
            <AgentCard
              key={agentKey(agent)}
              agent={agent}
              owner={me}
              siblings={(perThread.get(agent.taskId) ?? 1) - 1}
              viewing={agentKey(agent) === openAgent}
              onOpen={() => onOpenAgent(agentKey(agent))}
            />
          ))}
          <PeerCards peers={peerCards} byUser={byUser} />
        </div>
      )}
    </div>
  );
}
