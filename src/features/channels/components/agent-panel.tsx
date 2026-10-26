"use client";

/**
 * Channels — THE AGENT VIEW: a fourth surface that slides in over the info
 * panel and shows ONE of my agents from the inside.
 *
 * Nothing here is invented: the liveness, the context meter and the token/timing
 * line are this machine's own measurements (`agents-model.ts`); the Sent lane is
 * the messages this agent REALLY POSTED, read out of the same transcript the
 * thread renders (`agentSentMessages` below, which the window imports); the work
 * narration is the ring `dopl-desktop-app/main/session-narration.js` keeps; the
 * 1:1 lane goes over `sessions.message`.
 *
 * Why it is a panel and not a tab: the thread transcript is party-to-party
 * traffic, and much of what an agent does is addressed to its OPERATOR rather
 * than to the thread (INVARIANTS §5's Agents-tab bullet).
 *
 * This panel is the GLANCE: it slides in beside the thread you are reading and
 * answers "what is this agent up to" without taking you anywhere. The window is
 * the INSIDE, a surface you put beside your editor. Both mount the same stream
 * and the same 1:1 composer.
 *
 * ⚠ PAUSE / END ARE OWN-AGENTS-ONLY. See `agents-controls.ts › useAgentControls`
 * — the CONTROLS module, split out of `agents-model.ts` on 2026-08-20; the model
 * is the pure projection and owns no verb.
 * `end` ends the AGENT and touches no thread — a thread has no finished state
 * (INVARIANTS §5, wiring plan Phase 4).
 *
 * ⚠ COPY RULE (INVARIANTS §5): inside one member's window there is exactly ONE
 * session, so it never needs a qualifier. This is the surface where the
 * temptation lives, and the noun here is the AGENT — never "agent session",
 * never "channel session".
 */

import { useMemo, useState } from "react";
import { cn } from "@/shared/lib/utils";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelConsentRequest, ChannelMessage } from "../types";
import {
  agentDisplayName,
  agentKey,
  agentLiveness,
  postDestination,
  parseAgentPostStamp,
} from "./agents-model";
import { AgentComposer } from "./agent-composer";
import { useAgentIdentity } from "./agent-face";
import { AgentStream } from "./agent-stream";
import { useAgentNarration } from "./use-agent-narration";
import { indexMembers, viewerPerson, type AuthorIndex } from "./view-model";
import type { AgentColorKey } from "../types";
import { answersByEscalation } from "./view-model-display";
import type { AnswerDisplay } from "../hooks/use-display-writes";
import { AgentControls } from "./agent-panel-controls";
import { AgentPanelHeader } from "./agent-panel-header";
import { AgentStats } from "./agent-stats";

/**
 * WHAT THIS AGENT POSTED. Pure and exported for the test.
 *
 * ⚠ THE MATCH IS `threadId` + AGENT-AUTHORED + THE VIEWER'S OWN ACCOUNT, all
 * three. The desktop posts its agent's words over the OPERATOR'S credential with
 * `authorKind: "agent"` (INVARIANTS §5), so the account is what separates my
 * agent from a peer's — and `authorKind` alone would put a teammate's agent in
 * my panel. `authorKind` stays a DISPLAY claim here as everywhere: this panel
 * tags and filters, it does not authenticate.
 *
 * ⚠ AND SINCE 2026-08-22 (F-251) IT IS ALSO THE INSTANCE, because those three
 * predicates stop at the THREAD. Multiplayer puts N of one operator's agents on
 * one thread, all posting under that one account with `authorKind: "agent"`, so
 * every sibling's words showed up in every sibling's panel and window — the
 * surface whose entire promise is "this ONE agent, from the inside". The
 * discriminator is the writer's own `client_msg_id`, the same token
 * `main/session-dispatch.js › wroteIt` uses to keep an agent out of its own
 * fan-out; nothing else on the wire can tell two of my agents apart.
 *
 * ⚠ IT EXCLUDES ONLY WHAT IS POSITIVELY ATTRIBUTED TO SOMEBODY ELSE, and that
 * asymmetry is the whole design. An UNSTAMPED row (a main older than the stamp,
 * an agent that supplied its own idempotency key, and every courtesy no-op
 * `channel-post.js › postCourtesy` sends about the MACHINE rather than about one
 * agent) still shows, exactly as it did before this argument existed. Requiring
 * the stamp would have hidden all three classes, which trades one wrong lane for
 * a silently short one — and a lane that omits an agent's words is the harder
 * failure to notice.
 * ⚠ NO `agentId` AT ALL falls back to today's behaviour byte for byte: such a
 * main runs one agent per thread, so the thread IS the instance.
 *
 * ⚠ THE STAMP IS PARSED BY `agents-model.ts › parseAgentPostStamp`, NOT BY A
 * PATTERN WRITTEN HERE (2026-08-22). The transcript's per-agent attribution pill
 * reads the same token, and two hand-written charsets for one wire format is the
 * duplicate the review wave already caught once.
 */
export function agentSentMessages(
  messages: readonly ChannelMessage[],
  threadId: string,
  currentUserId: string,
  agentId?: string | null
): ChannelMessage[] {
  const mine = typeof agentId === "string" ? agentId.trim() : "";
  return messages.filter((m) => {
    if (
      m.kind !== "message" ||
      m.authorKind !== "agent" ||
      m.authorUserId !== currentUserId
    ) {
      return false;
    }
    // The thread join, exactly as it always worked: same thread, and not
    // positively attributed to a SIBLING instance.
    if (threadId && m.metadata.threadId === threadId) {
      if (!mine) return true;
      const stamped = parseAgentPostStamp(m.clientMsgId);
      return stamped === null || stamped === mine;
    }
    // ⚠ THE THREADLESS POST (2026-08-31, Samuel's attribution report — the
    // 2026-08-25 F-251 note measured this exact miss and fixed only the LANDING
    // check). A main-room post carries no `metadata.threadId`, so the join above
    // can never admit it and the agent's own sent box showed nothing for it.
    // With no thread to join on, only a POSITIVE per-instance attribution may
    // admit the row — the writer's own stamp, or the `session_id` the desktop
    // stamps on every outbound post (1.7.20) — because an unstamped threadless
    // row could be any sibling's, and the wrong lane is worse than a short one
    // here (the transcript still holds the post; this is the one surface where
    // attribution IS the claim).
    if (!mine) return false;
    const stamped = parseAgentPostStamp(m.clientMsgId);
    if (stamped === mine) return true;
    const sessionStamp = (m.metadata as { session_id?: unknown }).session_id;
    return typeof sessionStamp === "string" && sessionStamp === mine;
  });
}

export function ChannelsAgentPanel({
  openAgent,
  sessions,
  messages,
  pendingPosts,
  onPostPending,
  postBusy,
  onAnswerDisplay,
  currentUserId,
  index,
  workspaceSlug = "",
  full = false, color = null,
  onClose,
  onRefreshSessions,
}: {
  /**
   * **THE CHANNEL'S ROSTER** — members and every member's agents, for the addressee pills on a
   * posted box (#3081). The host already holds it (`derivations.ts › index`, spread onto
   * `ChannelSurfaceData`), so this panel still fetches nothing.
   *
   * ⚠ **IT IS NOT THE `displayIndex` BUILT BELOW.** That one is roster-LESS on purpose — what
   * gates a card's buttons is the viewer — and handing a roster to it would change which names
   * a DisplayCard labels. This is a second, read-only fact: what the addressees are CALLED.
   * ⚠ **OPTIONAL, AND ABSENT DRAWS NO PILLS** — the panel's long-standing "no roster prop
   * threaded through two hosts" rule is relaxed exactly this far: a caller that has not threaded
   * it renders what it rendered before, rather than facing people it would have to invent names
   * for (`agent-stream.tsx › roster`).
   */
  index?: AuthorIndex | null;
  /** `agentKey(session)` of the open agent, or `null` for closed. */
  openAgent: string | null;
  /** THE BANNER'S FILL (2026-09-13) — ⚠ resolved by the HOST off `channel-surface-data.ts ›
   *  liveAgents`, never from {@link sessions}: only the SERVER assigns a key. Rule: §5. */
  color?: AgentColorKey | null;
  sessions: readonly DesktopSessionSummary[] | null;
  /** The open channel's transcript — the source of the Sent lane. */
  messages: readonly ChannelMessage[];
  /**
   * The viewer's PENDING outbound consent rows — what makes a held draft's card
   * decidable in place (Samuel, 2026-08-25). The host already reads them
   * (`channel-surface-data.ts › requests`); this panel never fetches.
   */
  pendingPosts?: readonly ChannelConsentRequest[];
  /** Approve one held draft — the host's CAS'd consent mutation. */
  onPostPending?: (requestId: string) => void;
  postBusy?: boolean;
  /**
   * ANSWER one of this agent's DISPLAY / DECISION CARDS — the host's one answer write
   * (2026-08-31). ⚠ Absent renders no option buttons, never disabled ones; the
   * card is then the record of a question the operator answers in the channel.
   */
  onAnswerDisplay?: AnswerDisplay;
  currentUserId: string;
  /** The workspace SEGMENT, for the agent window's router path (2026-08-20).
   *  ⚠ Main holds the workspace UUID and a route needs the slug, so it can only
   *  come from here. Defaulted so a caller that has not threaded it yet renders
   *  the panel unchanged; main degrades an unusable segment rather than
   *  refusing. */
  workspaceSlug?: string;
  /**
   * RENDER AS THE MAIN AREA, not as the 380px overlay (Samuel, 2026-09-04 — the
   * WEB channel page). The phone has one column, so an agent's view REPLACES the
   * conversation under the header's dropdown instead of sliding over a tab
   * column that is not there. ⚠ Content-identical: only the geometry moves.
   */
  full?: boolean;
  onClose: () => void;
  /** Re-read the desktop's session feed. Called ONLY when main refuses a stop
   *  verb, which is the one state change no push announces. */
  onRefreshSessions?: () => void;
}) {
  const live =
    (openAgent &&
      sessions?.find((s) => agentKey(s) === openAgent)) || null;
  // The panel plays an exit, so it needs content for one more frame than the
  // state has. Keeping the last agent renders that frame with what was there
  // instead of sliding an empty box off the edge. State, not a ref: a ref may
  // not be written during render, and this is the sanctioned
  // derive-state-from-props adjustment (render restarts before committing).
  const [lastShown, setLastShown] = useState<DesktopSessionSummary | null>(null);
  if (live && live !== lastShown) setLastShown(live);
  const agent = live ?? lastShown;
  const open = live !== null;
  // ⚠ THE WORK LANE, ON THE SAME AGENT THE HEADER NAMES. Read here rather than
  // inside the stream so the hook's identity is the PANEL's open agent — a
  // subscription mounted below would key on whatever it was handed and go stale
  // one render later than the header it sits under.
  // ⚠ `agent?.agentId` IS THE THIRD KEY SEGMENT (F-250): main rings on
  // `<channel>:<thread>:<agent>`, and a two-segment filter matches nothing at all.
  const narration = useAgentNarration(
    agent?.channelId ?? "",
    agent?.threadId ?? "",
    agent?.agentId
  );
  // ⚠ THE VIEWER'S FACE, off the transcript this panel is already handed — no
  // roster prop threaded through two hosts and no second read (`view-model.ts ›
  // viewerPerson` carries why the transcript is the source).
  const viewer = useMemo(
    () => viewerPerson(messages, currentUserId),
    [messages, currentUserId]
  );
  // The agent's identity: its owner is the viewer (own agents only), in its colour ring.
  const face = useAgentIdentity({
    photo: viewer?.avatarUrl ?? null,
    name: agent ? agentDisplayName(agent) : null,
    color,
    runtime: agent?.runtimeId,
  });
  // WHICH DECISIONS ALREADY HAVE AN ANSWER — off the SAME transcript, through the SAME derivation
  // the channel view uses, so one question cannot read answered in one pane and open in the other.
  // ⚠ `indexMembers` with NO ROSTER: the viewer is what gates the buttons; who chose is labelled
  // off the answer message itself.
  const displayIndex = useMemo(() => indexMembers([], currentUserId), [currentUserId]);
  const displayAnswers = useMemo(
    () => answersByEscalation(messages, displayIndex),
    [messages, displayIndex]
  );

  return (
    <aside
      aria-label="Agent view"
      inert={!open}
      className={cn(
        // ⚠ THE WIDTH IS `--info-w`: this pane sits against the info column's right edge and the
        // operator drags that column (`use-info-resize.ts`), so any literal makes the divider jump
        // the moment an agent view opens. 380px is the fallback for a host that mounts no handle.
        // ⚠ THE GROUND IS `--home-card`, the same level the chat area behind it inherits: this
        // pane is a column of that area, not a card on it.
        "z-20 flex flex-col bg-[var(--home-card)]",
        full
          ? "min-h-0 min-w-0 flex-1"
          : "absolute inset-y-0 right-0 w-[var(--info-w,380px)]",
        // The account palette skin recolours `border-border-default`, so the divider and the
        // pane's own lines are one rule.
        !full && "border-l border-border-default",
        !full && "transition-transform duration-200 ease-out motion-reduce:transition-none",
        !full && (open ? "translate-x-0" : "pointer-events-none translate-x-full")
      )}
    >
      {agent && (
        <>
          <AgentPanelHeader agent={agent} face={face} onClose={onClose} />
          {/* The numbers ride inside the controls box, under its buttons: one band of chrome. */}
          <AgentControls
            agent={agent}
            workspaceSlug={workspaceSlug}
            onRefreshSessions={onRefreshSessions}
            stats={<AgentStats agent={agent} color={color} />}
          />
          {/* ⚠ `agent.agentId` IS THE FOURTH ARGUMENT (F-251): the panel is opened FROM one card,
              so a lane carrying its siblings' posts answers a click about a different agent.
              Narration is keyed on the same id (F-250), so both halves are this agent's. */}
          <AgentStream
            color={color}
            self={face}
            // The header pill's own verdict, handed down so the two cannot disagree.
            liveness={agentLiveness(agent)}
            entries={narration.entries}
            supported={narration.supported}
            sent={agentSentMessages(messages, agent.threadId, currentUserId, agent.agentId)}
            // ⚠ THE UNFILTERED TRANSCRIPT, BESIDE THE FILTERED ONE: `agentSentMessages` needs
            // `metadata.threadId`, which a threadless post lacks, so only this can answer "did
            // this draft land".
            delivered={messages}
            pending={pendingPosts}
            onPost={onPostPending}
            postBusy={postBusy}
            displayIndex={displayIndex}
            // ⚠ THE ROSTER, BESIDE THE VIEWER-ONLY `displayIndex` AND NOT INSTEAD OF IT —
            // two different questions, stated at the prop above.
            roster={index}
            displayAnswers={displayAnswers}
            onAnswerDisplay={onAnswerDisplay}
            destination={postDestination(agent)}
            viewer={viewer}
            className="px-3.5"
          />
          {/* ⚠ SHARED COMPONENT, never a second send path (`agent-composer.tsx`), and
              `agent.agentId` names WHICH instance this panel was opened from. */}
          <AgentComposer
            channelId={agent.channelId}
            threadId={agent.threadId}
            agentId={agent.agentId}
            runtimeId={agent.runtimeId}
            name={agentDisplayName(agent)}
            ended={agent.state === "ended"}
            currentUserId={currentUserId}
            className="px-3.5"
          />
        </>
      )}
    </aside>
  );
}
