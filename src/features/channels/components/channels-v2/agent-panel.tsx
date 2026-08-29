"use client";

/**
 * Channels v2 — THE AGENT VIEW: a fourth surface that slides in over the info
 * panel and shows ONE of my agents from the inside.
 *
 * ⚠ WIRED (wiring plan Phase 5, 2026-08-18). `fixtures-agents.ts` is DELETED and
 * nothing here is invented. The header identity, the liveness, the context meter
 * and the token/timing line are this machine's own measurements
 * (`agents-model.ts`); the feed is the messages this agent REALLY POSTED, read
 * out of the same transcript the thread renders.
 *
 * Why it is a panel and not a tab: the thread transcript is party-to-party
 * traffic, and much of what an agent does is addressed to its OPERATOR rather
 * than to the thread. That lane needs somewhere to live, and it is not the
 * transcript (INVARIANTS §5's Agents-tab bullet; the ruling arrived in the
 * port's intent doc, deleted at the Phase 12 cutover).
 *
 * ⚠ THE MOCK DREW THREE LANES, AND ALL THREE ARE BUILT — BUT TWO OF THEM LIVE IN
 * THE AGENT WINDOW, NOT HERE (2026-08-20, F-212's closure).
 *
 *  1. **Sent** — ✅ HERE. What this agent posted into its thread, captioned with
 *     where it went. The SAME strings the thread transcript carries, matched on
 *     `metadata.taskId` + an agent-authored row under the viewer's own account.
 *     `agentSentMessages` below is the derivation, and the window IMPORTS it
 *     rather than writing a second one.
 *  2. **Work narration** ("scanning 14 components…") — ✅ BUILT, in
 *     `components/channels-v2/agent-window.tsx` over the ring
 *     `dopl-desktop-app/main/session-narration.js` keeps.
 *  3. **The direct 1:1 lane** (me ↔ this agent, out of band) — ✅ BUILT, in that
 *     same window, over `sessions.message`.
 *
 * ⚠ THE SPLIT IS DELIBERATE AND IS NOT A MIGRATION-IN-PROGRESS. This panel is the
 * GLANCE: it slides in beside the thread you are reading and answers "what is
 * this agent up to" without taking you anywhere. The window is the INSIDE, for
 * when the answer is "let me watch it, and say something to it" — a surface you
 * put beside your editor. Cramming a live stream and a composer into a 380px
 * overlay on top of a transcript would make both worse.
 *
 * ⚠ AND THE COMPOSER STILL DOES NOT BELONG HERE. The old rule — an inert input
 * looks exactly like every input that does send, so render none — is why this
 * panel shipped without one. It has an "Open window" button instead, which is an
 * affordance that keeps its promise.
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
 *
 * The surface is the kit's `.bento` with its radius and three of its four
 * borders dropped: a full-height edge panel keeps the card's fill and its
 * elevation but cannot keep a 14px radius against the page edge.
 */

import { useMemo, useState } from "react";
import { Bot, CornerDownRight, X } from "lucide-react";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelConsentRequest, ChannelMessage } from "../../types";
import { IconButton } from "./bits";
import { AgentEndedPill, AgentLiveness } from "./agent-bits";
import {
  NO_THREAD_LABEL,
  agentDisplayName,
  agentKey,
  agentLiveness,
  agentRunningModel,
  parseAgentPostStamp,
} from "./agents-model";
import { formatTokens, metric } from "./agent-metrics";
import { agentModelShortLabel } from "../../lib/agent-models";
import { AgentComposer } from "./agent-composer";
import { AgentStream } from "./agent-stream";
import { useAgentNarration } from "./use-agent-narration";
import { viewerPerson } from "./view-model";
// ⚠ THE CONTROL STRIP IS ITS OWN FILE since 2026-08-22 (`agent-panel-controls.tsx`),
// split at the 500-line cap when the composer landed — and on the COMMANDS seam,
// not an arbitrary cut: it changes when the bridge does, this file when the layout
// does. `AGENT_CONTROL_REFUSED` moved with it, being that strip's copy.
import { AgentControls } from "./agent-panel-controls";

/**
 * WHAT THIS AGENT POSTED. Pure and exported for the test.
 *
 * ⚠ THE MATCH IS `taskId` + AGENT-AUTHORED + THE VIEWER'S OWN ACCOUNT, all
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
  taskId: string,
  currentUserId: string,
  agentId?: string | null
): ChannelMessage[] {
  if (!taskId) return [];
  const mine = typeof agentId === "string" ? agentId.trim() : "";
  return messages.filter((m) => {
    if (
      m.kind !== "message" ||
      m.authorKind !== "agent" ||
      m.authorUserId !== currentUserId ||
      m.metadata.taskId !== taskId
    ) {
      return false;
    }
    if (!mine) return true;
    const stamped = parseAgentPostStamp(m.clientMsgId);
    return stamped === null || stamped === mine;
  });
}

export function ChannelsV2AgentPanel({
  openAgent,
  sessions,
  messages,
  pendingPosts,
  onPostPending,
  postBusy,
  currentUserId,
  workspaceSlug = "",
  onClose,
  onRefreshSessions,
}: {
  /** `agentKey(session)` of the open agent, or `null` for closed. */
  openAgent: string | null;
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
  currentUserId: string;
  /** The workspace SEGMENT, for the agent window's router path (2026-08-20).
   *  ⚠ Main holds the workspace UUID and a route needs the slug, so it can only
   *  come from here. Defaulted so a caller that has not threaded it yet renders
   *  the panel unchanged; main degrades an unusable segment rather than
   *  refusing. */
  workspaceSlug?: string;
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
    agent?.taskId ?? "",
    agent?.agentId
  );
  // ⚠ THE VIEWER'S FACE, off the transcript this panel is already handed — no
  // roster prop threaded through two hosts and no second read (`view-model.ts ›
  // viewerPerson` carries why the transcript is the source).
  const viewer = useMemo(
    () => viewerPerson(messages, currentUserId),
    [messages, currentUserId]
  );

  return (
    <aside
      aria-label="Agent view"
      inert={!open}
      className={cn(
        // ⚠ `w-[380px]` IS PAIRED WITH `.channel-info-slide`'s open width
        // (globals.css + the desktop `kit.css` copy) — Samuel, 2026-08-25. This
        // panel is absolutely positioned against the SAME right edge as the
        // info column, so a mismatch makes the divider jump sideways the moment
        // an agent view opens. **Change one and change the other.**
        // ⚠ NOT `.bento` ANY MORE (Samuel, 2026-08-27). That recipe is a floating CARD — its own
        // fill, hairline and drop shadow — and this pane is not a card ON the chat area, it is a
        // COLUMN OF IT. The shadow and the pale hairline were what made it read as a lighter
        // surface sitting on top. It takes the SAME fill the surface behind it has
        // (`.page-float` → `--panel-surface`, `channels-v2-core.tsx`), stated explicitly so the
        // two cannot drift if either recipe moves.
        "absolute inset-y-0 right-0 z-20 flex w-[380px] flex-col bg-[var(--panel-surface)]",
        // ⚠ THE DIVIDER IS `border-l border-border-default` — THE SAME CLASS THIS PANE'S OTHER
        // LINES ALREADY CARRY, and that is the whole point. Its header rule is
        // `border-b border-border-default`; on /home BOTH are recoloured to the account palette's
        // `--home-panel-line` by `pages/home/home.module.css › .frame :global(.border-border-
        // default)`, which is the blue Samuel is pointing at. **The colour is not chosen here** —
        // it is whatever that scoped rule says, so the divider and the pane's own lines cannot
        // differ. An earlier attempt hardcoded `border-link`, a DIFFERENT blue, and in doing so
        // dropped the class the /home rule keys on.
        // ⚠ 2px COMES FROM THE SAME MODULE, not from a number here: `.frame :global(.border-l
        // .border-border-default)` widens exactly this shape. On the workspace channels page it
        // stays a neutral hairline, which is that page's own idiom.
        "border-l border-border-default",
        "transition-transform duration-200 ease-out motion-reduce:transition-none",
        open ? "translate-x-0" : "pointer-events-none translate-x-full"
      )}
    >
      {agent && (
        <>
          <AgentPanelHeader agent={agent} onClose={onClose} />
          {/* ⚠ ONE BOX, NOT TWO (Samuel, 2026-08-27). The context meter had a strip of its own
              directly above the pause/end/open row — two stacked bands of chrome saying things
              about the same agent, which ate the height the STREAM wants. The stats now render
              inside the controls box, under its buttons. */}
          <AgentControls
            agent={agent}
            workspaceSlug={workspaceSlug}
            onRefreshSessions={onRefreshSessions}
            stats={<AgentStats agent={agent} />}
          />
          {/* ⚠ THE FULL STREAM, NOT A SENT-LANE (Samuel, 2026-08-22). The panel
              showed only what the agent had POSTED, which is the one lane that
              says least about what it is doing — an agent mid-tool-run read as an
              agent doing nothing. It now shares the window's stream whole
              (`agent-stream.tsx`); the panel is the same content at another
              width, not a different question.
              ⚠ `agent.agentId` IS THE FOURTH ARGUMENT (F-251): the panel is
              opened FROM one card, so a lane carrying its siblings' posts answers
              a click about a different agent. Narration is keyed on the same id
              (F-250), so both halves of the stream are this agent's. */}
          <AgentStream
            entries={narration.entries}
            supported={narration.supported}
            sent={agentSentMessages(
              messages,
              agent.taskId,
              currentUserId,
              agent.agentId
            )}
            // ⚠ THE UNFILTERED TRANSCRIPT, BESIDE THE FILTERED ONE (2026-08-25).
            // `agentSentMessages` requires `metadata.taskId`, which a threadless
            // post does not carry — so it cannot answer "did this draft land",
            // and a held card went on saying "Not sent" over a delivered post.
            delivered={messages}
            pending={pendingPosts}
            onPost={onPostPending}
            postBusy={postBusy}
            threadTitle={agent.threadTitle}
            // ⚠ THE VIEWER'S FACE for their own turns, resolved off the SAME
            // transcript the Sent lane reads (`view-model.ts › viewerPerson`) —
            // no roster prop to thread through two hosts, and no second read.
            viewer={viewer}
            className="px-3.5"
          />
          {/* ⚠ THE 1:1 LANE IS HERE NOW (Samuel, 2026-08-22), not only in the
              window. The footer note used to send the operator away to say one
              sentence to their own agent — the glance is exactly where a short
              steer belongs. ⚠ SHARED COMPONENT, never a second send path
              (`agent-composer.tsx`), and `agent.agentId` names WHICH instance:
              this panel is opened FROM one card, so reaching the thread's oldest
              agent instead would answer a click about a different agent. */}
          <AgentComposer
            channelId={agent.channelId}
            taskId={agent.taskId}
            agentId={agent.agentId}
            name={agentDisplayName(agent)}
            ended={agent.state === "ended"}
            className="px-3.5"
          />
        </>
      )}
    </aside>
  );
}

function AgentPanelHeader({
  agent,
  onClose,
}: {
  agent: DesktopSessionSummary;
  onClose: () => void;
}) {
  return (
    <header className="flex h-[56px] shrink-0 items-center gap-2 border-b border-border-default px-3.5">
      <Bot size={15} aria-hidden className="shrink-0 text-text-secondary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-text-primary">
          {agentDisplayName(agent)}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-caption text-text-secondary">
          <CornerDownRight size={11} aria-hidden className="shrink-0 text-text-muted" />
          <span className="truncate">
            in {agent.threadTitle ?? NO_THREAD_LABEL}
          </span>
        {/* ⚠ THE EFFECTIVE MODEL, and ONLY when this build reports one
            (2026-08-22). It rides the detail line that already exists rather than
            earning chrome of its own — minimal copy (INVARIANTS §5). Absent
            renders NOTHING: a main that does not report a model has said nothing
            about what this agent is running, and "Default" would be this build
            claiming to know (`agents-model.ts › agentRunningModel`). */}
          {agentModelShortLabel(agentRunningModel(agent)) && (
            <span className="shrink-0 text-text-muted">
              · {agentModelShortLabel(agentRunningModel(agent))}
            </span>
          )}
        </span>
      </span>
      {/* ⚠ The pill REPLACES the liveness on an ended agent — one fact, one
          element. `bits.tsx › AgentEndedPill` carries why. */}
      {agent.state === "ended" ? (
        <AgentEndedPill />
      ) : (
        <AgentLiveness {...agentLiveness(agent)} />
      )}
      <IconButton icon={X} label="Close agent view" size={15} onClick={onClose} />
    </header>
  );
}

/**
 * The compact restatement of the card's numbers.
 *
 * ⚠ Absences render AS absences: no denominator, no stamp, no clause. Never a zero standing in
 * for "not measured".
 * ⚠ THIS SAID "no denominator, NO METER", ON THE HEADER-STRIP FACE (`bg-card-surface-subtle`),
 * AND BOTH CLAUSES WERE STALE BY 2026-08-28. The strip face is not applied here any more, and
 * the 2026-08-27 ruling renders the BAR unconditionally at 0 so a spawn-idle agent gets a box
 * rather than nothing. The DENOMINATOR half is the live rule, and it is
 * `shared/ui/usage-meter.tsx` that keeps it — a reported `contextUsed` with no `contextWindow`
 * prints the number alone, never `84k / 0k`.
 */
function AgentStats({ agent }: { agent: DesktopSessionSummary }) {
  const used = metric(agent.contextUsed);
  const window = metric(agent.contextWindow);
  const spent = metric(agent.tokensSpent);
  const startedAt = metric(agent.startedAt);
  const lastAt = metric(agent.lastActivityAt);
  const line = [
    startedAt !== null &&
      `Started ${formatRelativeTime(new Date(startedAt).toISOString())}`,
    spent !== null && `${formatTokens(spent)} tokens spent`,
    lastAt !== null &&
      `Last activity ${formatRelativeTime(new Date(lastAt).toISOString())}`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-1.5">
      {/* ⚠ THE BAR AT ZERO, ALWAYS — THERE IS NO "not measured" LINE ANY MORE (Samuel,
          2026-08-27, on the rendered pane).
          ⚠ THE FIRST ATTEMPT KEPT A `window === null` ARM, and that arm is the one this surface
          actually hits: a spawn-idle agent has sent nothing, so main has reported no
          `contextWindow` yet and the box read "Context use is not measured yet." — a dead line
          where the operator wanted the object they watch fill. A fresh agent's usage is a
          MEASURED zero, and zero is what a bar is for.
          ⚠ `UsageMeter` OWNS THE NO-DENOMINATOR CASE and always did: "Zero/negative limit: empty
          track rather than dividing by it" (`shared/ui/usage-meter.tsx`), so `limit={0}` draws the
          empty track rather than a division. Nothing is invented here — the arithmetic guard is
          the meter's own, which is why this can be one unconditional call. */}
      <UsageMeter
        label="Context tokens"
        used={used ?? 0}
        limit={window ?? 0}
        tone="ramp"
        formatValue={formatTokens}
      />
      {line.length > 0 && (
        <p className="text-caption text-text-muted">{line.join(" · ")}</p>
      )}
    </div>
  );
}
