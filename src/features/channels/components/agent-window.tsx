"use client";

/**
 * THE AGENT WINDOW — one of my agents, from the inside (2026-08-20, F-212's closure).
 *
 * ⚠ WHAT IT REPLACES, AND WHAT IT IS NOT. The session window is retired (INVARIANTS §11,
 * F-228) and none of it comes back: no transcript of its own, no permission cards, no
 * folder chip, no modes header — those moved to the channels surfaces or died with the
 * retirement. What was genuinely LOST when it went is the ability to watch one agent work
 * and to say something to it, and that is exactly what this window restores, on the
 * channels tree, over the ops the Agents tab already uses.
 *
 * ⚠ THE THREE LANES `agent-panel.tsx` DREW ARE ALL WIRED HERE NOW. It shipped rendering
 * only the SENT lane and STATING the other two absences rather than faking them; F-212 was
 * that statement. All three have a backing:
 *
 *   1. **Work narration** — the ring `main/session-narration.js` keeps, over a second
 *      bridge channel. Tool calls carry their NAMES, which was the specific half F-212's
 *      entry called out.
 *   2. **Sent** — what this agent posted, the same derivation the panel uses
 *      (`agent-panel.tsx › agentSentMessages`), imported rather than re-written.
 *   3. **The direct 1:1 lane** — the composer at the foot. It reaches
 *      `sessions.message`, the one bridge op that starts a turn.
 *
 * ⚠ THE PANEL SURVIVES AND IS NOT THIS. `agent-panel.tsx` is the GLANCE — it slides in
 * over the info panel, beside the thread you are reading, and answers "what is this agent
 * up to". This is the INSIDE, in its own window, beside your editor. Two surfaces, one
 * feed, one derivation each; nothing here re-reads anything the panel already reads.
 *
 * ⚠ IT IS ROUTER-FREE like every file in this tree — the SPA page owns the params.
 */

import { useEffect, useMemo } from "react";
import { Bot, CornerDownRight } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { CONSENT_INBOX_POLL_MS } from "../constants";
import { useChannelMessages } from "../hooks/use-channel-messages";
import { useConsentInbox } from "../hooks/use-consent-inbox";
import { useChannelPreferenceWrites } from "../hooks/use-channel-preference-writes";
import { useChannelsLive } from "./live";
import { agentSentMessages } from "./agent-panel";
import { AgentStream } from "./agent-stream";
import { splitEndNote } from "./agent-stream-lanes";
import { AgentEndedPill, AgentLiveness } from "./agent-bits";
import { NO_THREAD_LABEL, agentDisplayName, agentLiveness, postDestination } from "./agents-model";
import { viewerPerson } from "./view-model";
import { useDesktopSessions } from "./use-desktop-sessions";
import { AgentComposer } from "./agent-composer";
import { AgentHeldGates } from "./agent-held-gate";
import { AgentStats } from "./agent-stats";
import { PostureControls } from "./agent-posture";
import { useAgentNarration } from "./use-agent-narration";

/** The window's name. ⚠ `main/agent-window.js` carries the bare "Dopl" as the PRE-PAINT
 *  title, so a window that never finishes loading is still named. */
export function agentWindowTitle(name: string | null): string {
  return name ? `Dopl — ${name}` : "Dopl";
}

/**
 * Name the WINDOW from the renderer. ⚠ MAIN CANNOT DO THIS: it creates the window from
 * (segment, channel, thread) and has no handle to name — handles live in the local session
 * projection the renderer subscribes to. Electron's default `page-title-updated` handling
 * copies `document.title` onto the window; `agent-window.js` does not disable it and must
 * not start to. Same mechanism as `thread-window.tsx › threadWindowTitle`.
 */
function useWindowTitle(name: string | null): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = agentWindowTitle(name);
    return () => {
      document.title = previous;
    };
  }, [name]);
}

export function ChannelsAgentWindow({
  workspaceId,
  channelId,
  taskId,
  agentId = null,
  currentUserId,
}: {
  workspaceId: string;
  channelId: string;
  /** The agent's own half of its key — `?thread=`. `""` is a real value (a responder with
   *  no first-class thread), and is why this is not gated on truthiness. */
  taskId: string;
  /**
   * WHICH INSTANCE — `?agent=`, when the URL carries one (2026-08-22).
   *
   * ⚠ OPTIONAL BECAUSE MAIN MINTS THIS URL. `(channel, thread)` names a GROUP of
   * the operator's agents since multiplayer, so without this the window lands on
   * whichever of them the feed lists first — a real ambiguity, and F-239's
   * remaining half. This side reads the param NOW so the moment main starts
   * emitting it the window resolves exactly, with no second change here.
   */
  agentId?: string | null;
  currentUserId: string;
  /**
   * ⚠ **`logoSrc` LEFT THIS COMPONENT ON 2026-09-13.** The mark is the WINDOW's chrome, not an
   * agent view's (*"We're moving the logo out to the top left"*), so the page hands it to
   * `agent-window-shell.tsx` instead — which is also where the `#/`-alias argument now lives.
   */
}) {
  // ⚠ THE SAME FEED THE AGENTS TAB TAKES, filtered to one agent. A window makes its own
  // subscription because it is a different React tree in a different BrowserWindow — main
  // fans every push out over the app-window registry precisely so this works.
  // ⚠ `refresh` IS THE HELD GATE'S REFUSAL PATH AND NOTHING ELSE (R-24,
  // 2026-09-17) — `use-desktop-sessions.ts` carries why it is not a poll.
  const { sessions, refresh } = useDesktopSessions();
  // ⚠ THE ID WHEN THE URL HAS ONE, THE PAIR WHEN IT DOES NOT (2026-08-22).
  // `(channel, thread)` addresses a THREAD since multiplayer, so the pair alone
  // lands on whichever of this operator's agents the feed lists first. `?agent=`
  // is what makes the answer exact; its ABSENCE is the honest degradation and not
  // an error, because a main that does not emit it also runs at most one agent
  // per thread — the same rule every session op follows (`agents-controls.ts`).
  const agent = useMemo(
    () =>
      sessions?.find(
        (s) =>
          s.channelId === channelId &&
          s.taskId === taskId &&
          (!agentId || s.agentId === agentId)
      ) ?? null,
    [sessions, channelId, taskId, agentId]
  );
  // ⚠ THE RESOLVED AGENT'S OWN ID, NOT THE ROUTE'S PARAM (2026-08-22, F-250).
  // `agentId` above is the URL's, which main does not emit yet; `agent.agentId`
  // is what the FEED says the agent on screen is, so the work lane keys on the
  // agent whose header is above it either way.
  const { entries: narration, supported } = useAgentNarration(
    channelId,
    taskId,
    agent?.agentId
  );
  // 🔒 **THE END NOTICE LEAVES THE LOG AND BECOMES THE THREAD LINE'S BADGE** (Samuel, 2026-09-15 —
  // see {@link AgentWorkingOn} and `agent-stream-lanes.ts › splitEndNote`).
  // ⚠ **ONLY FOR AN AGENT THE FEED CALLS ENDED.** A retained ring can still hold an end from a
  // key that was reopened; splitting unconditionally would delete a line about a PAST life of a
  // LIVE agent and show it nowhere, which is the one outcome this move must not produce.
  const ended = agent?.state === "ended";
  const { entries, endNote } = useMemo(
    () => (ended ? splitEndNote(narration) : { entries: narration, endNote: null }),
    [ended, narration]
  );
  // The Sent lane reads the channel transcript, exactly as the panel's does.
  const { messages, refetch: refetchMessages } = useChannelMessages(
    channelId,
    workspaceId
  );
  // ⚠ THE WINDOW READS CONSENT ITSELF, and that is not a fork of the page's read
  // (2026-08-25). This is a different React tree in a different BrowserWindow —
  // it inherits no provider state — so the same hook mounts here exactly as the
  // narration and session feeds do. Workspace-wide with the same realtime
  // BACKSTOP poll the channels surface uses; the join is on the draft's own body
  // (`agent-stream-model.ts`), so a wider read costs nothing in precision.
  const { outbound: pendingPosts, refetch: refetchPending } = useConsentInbox(
    workspaceId,
    undefined,
    CONSENT_INBOX_POLL_MS
  );

  // ⚠ THIS WINDOW REGISTERS FOR THE DOORBELL (2026-08-20). It did not until then,
  // and the failure had no error shape: the narration and posture lanes are
  // bridge-PUSHED and stayed live, so the window looked healthy while the SENT
  // lane — its only server read — silently stopped updating after mount. A third
  // BrowserWindow inherits nothing; `main/ui-sync.js › sendToWindows` fans the
  // bell out over the app-window registry, but only a surface that SUBSCRIBED
  // hears it (INVARIANTS §7). This is the third registered live surface in
  // channels, after the page core and the pop-out thread window.
  //
  // ⚠ MESSAGES AND CONSENT, and that is the whole diet. There is no roster and
  // no thread list here — nothing to refetch and no presence dot to keep fresh —
  // so `refetchMembers` is deliberately a no-op rather than a read this surface
  // would then have to justify owning.
  // ⚠ THE `gate` IS TAKEN NOW (2026-08-25). This window HAS a server write: the
  // held-draft card's Post is the CAS'd `PATCH /consent/[id]`, and a write that
  // skips the coordinator lets a coalesced refetch land mid-flight (INVARIANTS
  // §7/§8). Its composer still reaches `sessions.message` over the bridge, which
  // posts nothing and needs no gate.
  const { gate } = useChannelsLive({
    workspaceId,
    refetchAll: () => {
      void refetchMessages();
      void refetchPending();
    },
    refetchMembers: () => {},
  });
  const { consent } = useChannelPreferenceWrites({ workspaceId, gate });

  // ⚠ THE INSTANCE IS THE FOURTH ARGUMENT (2026-08-22, F-251) — without it this
  // window's Sent lane shows every sibling agent's posts on the same thread as
  // if they were this one's.
  const sent = useMemo(
    () => agentSentMessages(messages, taskId, currentUserId, agent?.agentId),
    [messages, taskId, currentUserId, agent?.agentId]
  );

  // ⚠ THE VIEWER'S FACE, OFF THE TRANSCRIPT THIS WINDOW ALREADY READS (Samuel,
  // 2026-08-27 — their own turns in the stream wear it). No roster read: the
  // window's diet is messages + consent and stays that way, and the hydrated
  // author fields are keyed on the user id, so a row this viewer authored
  // carries the profile a roster would have handed back (`view-model.ts ›
  // viewerPerson`).
  const viewer = useMemo(
    () => viewerPerson(messages, currentUserId),
    [messages, currentUserId]
  );

  // ⚠ THE DISPLAY NAME, NEVER THE RAW ID (Samuel, 2026-08-27 — now a stated rule, INVARIANTS §5).
  // This wrote `agentDisplayId`, so the OS window read "Dopl — aczfk4p8": an eight-character
  // machine token as the title of a window a person keeps in their dock. `agentDisplayName`
  // resolves the operator's own name, falling back to `Agent #<id>` — which is a NAME the
  // operator was shown at launch and accepted, not a raw id leaking through.
  // ⚠ MAIN NEEDS NO CHANGE FOR THIS. Electron copies `document.title` onto the window and
  // `main/agent-window.js` does not disable it, so writing the document title IS setting the
  // window title — and a rename re-renders this, which re-writes it.
  useWindowTitle(agent ? agentDisplayName(agent) : null);

  // ⚠ `sessions === null` is "could not ask" and is NOT the same as "this agent is gone".
  // Rendering the gone-state over a browser (or a main without the feed) would be a claim
  // about the operator's machine that this surface cannot make.
  if (sessions !== null && !agent) {
    return (
      // ⚠ THE SAME GROUND AS THE LOADED WINDOW BELOW, and it is the layer this
      // branch was missed on. It kept `.page-float` after the main return gave it
      // up, so an operator whose agent had ended saw exactly the floating rounded
      // panel the 2026-08-27 fix removed — the gone-state is the ONE view that
      // window shows on its own, which is the worst place to leave the old face.
      // ⚠ NO FILL ON THIS BRANCH EITHER (2026-09-13): both branches render INSIDE the shell's
      // white `.bento`, so the gone-state paints nothing of its own. It kept `.page-float` once
      // and then `--panel-surface`; the lesson each time was that this branch is the one view the
      // window shows entirely on its own, which makes it the worst place to leave an old face.
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <EmptyState
          icon={Bot}
          title="That agent isn't running"
          description="It may have ended, or it belongs to a different machine. The channel transcript keeps what it sent."
        />
      </div>
    );
  }

  return (
    // 🔒 **NO GROUND OF ITS OWN SINCE 2026-09-13.** The white face is the SHELL's inset panel
    // (`agent-window-shell.tsx › INSET_PANEL`, a `.bento`) and this component fills it — Samuel's
    // tabbed-window ruling made the window gray and the agent view a card inside it, which
    // SUPERSEDES the 2026-08-27 "the pop-out is the panel, edge to edge" pass that had this file
    // painting `--panel-surface` on both branches. One painter per surface: a fill here would sit
    // inside the card and hide its radius.
    //
    // 🔒 **`min-w-0` IS THIS VIEW'S LINK IN THE SHRINK CHAIN (Samuel, 2026-09-13: *"The white panel,
    // the contents of the white panel, should be resizing."*).** The posture row inside is
    // `flex-nowrap` and the window is 510px wide, so this column's min-content width is wide — and
    // a flex item that cannot go below its content's min-content width does not shrink, it pushes.
    // `agent-window-shell.tsx` and `agent-window-frame.ts › INSET_PANEL` carry the other links, and
    // ALL of them are needed: the chain is only as good as its weakest.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* ⚠ WHICH THREAD, KEPT — it moved OUT of the chrome with the tabs (the strip already says
          which agent, so the name was said twice; where it is WORKING was not said at all).
          🔒 **AND SINCE 2026-09-15 IT CARRIES THE AGENT'S BADGE ON ITS RIGHT** — see the
          component. */}
      <AgentWorkingOn agent={agent} endNote={endNote} />
      {agent ? (
        <PostureControls
          agent={agent}
          channelId={channelId}
          taskId={taskId}
          // 🔒 `meterClassName=""` (Samuel, 2026-09-15) and no start stamp — the two
          // differences that used to justify a second copy of this component (P17,
          // collapsed 2026-09-17); `agent-stats.tsx` carries both reasons.
          stats={
            <AgentStats agent={agent} meterClassName="" showStarted={false} />
          }
        />
      ) : null}
      {/* 🔒 **THE HELD-GATE CARD, IN THE WINDOW TOO** (Samuel's ruling R-24,
          2026-09-17 — (b), not (a)). ⚠ **THE CARD ONLY — Pause/End STAY
          PANEL-ONLY**; `agent-held-gate.tsx` carries both rules and its own
          absent-never-inert check.
          ⚠ ITS OWN PADDING, because `PostureControls` above owns a bordered strip
          and the stream below carries `px-4`; this sits between them. */}
      {agent ? (
        <AgentHeldGates
          agent={agent}
          onRefreshSessions={refresh}
          className="shrink-0 px-4 pt-2.5"
        />
      ) : null}
      <AgentStream
        // ⚠ THE LIVE TAIL (Samuel, 2026-09-14) — the same verdict the window
        // chrome's badge shows (`agent-window-chrome.tsx`), from the one mapping.
        // ⚠ NO AGENT RESOLVED IS `null`, never an invented state: the feed has not
        // said, and the stream then draws nothing.
        liveness={agent ? agentLiveness(agent) : null}
        entries={entries}
        supported={supported}
        sent={sent}
        delivered={messages}
        pending={pendingPosts}
        onPost={(id) => consent.mutate({ id, decision: "allow" })}
        postBusy={consent.pending}
        // ⚠ THE BANNER NAMES THE PLACE (Samuel, 2026-09-16); `null` while no agent
        // has resolved, which reads as the bare noun rather than a blank.
        destination={agent ? postDestination(agent) : null}
        viewer={viewer}
        className="px-4"
      />
      <AgentComposer
        channelId={channelId}
        taskId={taskId}
        agentId={agent?.agentId}
        runtimeId={agent?.runtimeId}
        name={agent ? agentDisplayName(agent) : null}
        ended={ended}
        className="px-4"
      />
    </div>
  );
}

/**
 * WHERE THIS AGENT IS WORKING, AND HOW IT IS — one row at the top of the panel.
 *
 * 🔒 **THE BADGE RIDES THIS LINE, RIGHT-ALIGNED** (Samuel, 2026-09-15: *"put it on the right of the
 * line where it says 'in main channel'. Similarly, for where you see 'running', 'thinking', or
 * 'working' (all of those little things), put that in the same spot … but to the right, aligned to
 * the right."*) — so the chrome's corner says nothing about an agent (`agent-window-chrome.tsx`).
 *
 * ⚠ **BOTH STATES RIDE THE SAME SLOT AND `agents-model.ts › agentLiveness` IS STILL THE ONE
 * MAPPING.** Live → `AgentLiveness`; ended → the black `AgentEndedPill` over MAIN's own sentence,
 * which `agent-stream-lanes.ts › splitEndNote` lifted out of the work log so the end is stated
 * exactly once. The pill REPLACES the liveness rather than joining it — `agentLiveness` would
 * otherwise say "Ended" beside a pill saying "Ended by you".
 * ⚠ **THE STREAM'S LIVE TAIL STAYS** (`agent-stream-working.tsx`, Samuel 2026-09-14: the working
 * state must be visible *"where the reply will appear, not only in the header's corner"*).
 *
 * ⚠ **THE LINE TRUNCATES AND THE BADGE DOES NOT.** `min-w-0 flex-1` on the thread half is what
 * makes a long thread title ellipsize instead of pushing the badge off a 510px window; both badges
 * are already `shrink-0` in their own files.
 * ⚠ **NO AGENT RESOLVED DRAWS NO BADGE** — the feed has not said, and an invented state is worse
 * than an empty right edge (INVARIANTS §11).
 * ⚠ **THE VERTICAL PADDING IS UNCHANGED** (`pt-3`, no `pb`): the gap under this row is the posture
 * block's `py-2.5`, which is the equality Samuel set earlier the same day and
 * `agent-window-frame.test.ts` pins.
 */
function AgentWorkingOn({
  agent,
  endNote,
}: {
  agent: DesktopSessionSummary | null;
  /** Main's own end sentence, or `null` for the bare "Ended" — see `AgentEndedPill`'s `label`. */
  endNote: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-4 pt-3">
      <p className="flex min-w-0 flex-1 items-center gap-1 text-caption text-text-secondary">
        <CornerDownRight size={11} aria-hidden className="shrink-0 text-text-muted" />
        <span className="truncate">in {agent?.threadTitle ?? NO_THREAD_LABEL}</span>
      </p>
      {agent ? (
        agent.state === "ended" ? (
          <AgentEndedPill label={endNote ?? undefined} />
        ) : (
          <AgentLiveness {...agentLiveness(agent)} />
        )
      ) : null}
    </div>
  );
}

/**
 * ⚠ **THE HEADER LEFT THIS FILE ON 2026-09-13** — `agent-window-chrome.tsx ›
 * AgentWindowChrome`, because the bar is the WINDOW's now and not this agent's: it carries the tab
 * strip, and the tab strip outlives any one agent view. The drag region, the mark, the status badge
 * and the expand/close pair went with it unchanged; `DRAG_REGION` / `NO_DRAG_REGION` /
 * `WINDOW_GLYPH` are declared there. This file is the agent VIEW that a tab shows.
 */

/**
 * THE TOP BAR — the Dopl mark, the agent's name, then the right-hand controls (Samuel,
 * 2026-09-13, modelling Wispr Flow's pop-out).
 *
 * ⚠ THE BAR ICON IS GONE AND THE NAME TOOK ITS PLACE. It was a 15px lucide `Bot` glyph at the far
 * left — a picture of the CATEGORY "agent", in the one window that shows exactly one of them, and
 * therefore the least informative thing that could sit in the bar's most prominent slot. Samuel:
 * *"put the name of the top bar, the first top bar that holds the agent's name, at the top instead
 * of the bar icon"*. `Bot` is still imported: it is the gone-state's `EmptyState` icon.
 *
 * ⚠ THE MARK IS A ROUNDED SQUARE SHORTER THAN THE BAR, and that is the whole instruction (*"It
 * should not be the same height as the top bar, but be to the left of the name"*): 24px inside a
 * 56px bar, `rounded-[8px]`.
 *
 * ⚠ THE RIGHT GROUP READS STATUS → EXPAND → CLOSE (Samuel, same day: *"move the ended
 * badge/thinking badges and stuff to the left of the expand and X buttons"*). The badges are the
 * SAME components the bar already rendered — `AgentEndedPill` / `AgentLiveness` over
 * `agents-model.ts › agentLiveness`, which is the one mapping from state to word — moved, not
 * restated.
 *
 * ⚠ THERE IS NO "End" CONTROL IN THIS HEADER TO MOVE. The verb lives on the SLIDE-OUT PANEL's
 * strip (`agent-panel-controls.tsx › AgentControls`, Pause / End / Open window), which this window
 * has never mounted — so the badge is the only thing that was sitting at the end of this bar. It is
 * deliberately not INVENTED here: a destructive verb appearing in a window that never had one is a
 * new control, not a move. ⚠ **AND R-24 (2026-09-17) DID NOT CHANGE THAT**: the HELD-GATE CARD came
 * across to the window, the strip's verbs did not — see the mount in {@link ChannelsAgentWindow}.
 *
 * ⚠ THE TWO BUTTONS RENDER ONLY WHEN THEY CAN ACT. `canControlOwnWindow()` detects the BRIDGE op
 * (`spa-bridge-window.ts` carries why it is not the wrapper), so a plain browser and a main
 * predating `main/window-chrome.js` show no chrome rather than buttons that refuse — the
 * feature-detection rule the whole bridge family follows (INVARIANTS §11).
 */

