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
import { UsageMeter } from "@/shared/ui/usage-meter";
import { EmptyState } from "@/shared/ui/empty-state";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { CONSENT_INBOX_POLL_MS } from "../../constants";
import { useChannelMessages } from "../../hooks/use-channel-messages";
import { useConsentInbox } from "../../hooks/use-consent-inbox";
import { useChannelPreferenceWrites } from "../../hooks/use-channel-preference-writes";
import { useChannelsV2Live } from "./live";
import { agentSentMessages } from "./agent-panel";
import { AgentEndedPill, AgentLiveness } from "./agent-bits";
import { AgentStream } from "./agent-stream";
import {
  NO_THREAD_LABEL,
  agentDisplayName,
  agentLiveness,
} from "./agents-model";
import { formatTokens, metric } from "./agent-metrics";
import { viewerPerson } from "./view-model";
import { useDesktopSessions } from "./use-desktop-sessions";
import { AgentComposer } from "./agent-composer";
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

export function ChannelsV2AgentWindow({
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
}) {
  // ⚠ THE SAME FEED THE AGENTS TAB TAKES, filtered to one agent. A window makes its own
  // subscription because it is a different React tree in a different BrowserWindow — main
  // fans every push out over the app-window registry precisely so this works.
  const { sessions } = useDesktopSessions();
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
  const { entries, supported } = useAgentNarration(channelId, taskId, agent?.agentId);
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
  const { gate } = useChannelsV2Live({
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
      <div className="flex min-h-0 flex-1 flex-col bg-[var(--panel-surface)] antialiased">
        <EmptyState
          icon={Bot}
          title="That agent isn't running"
          description="It may have ended, or it belongs to a different machine. The channel transcript keeps what it sent."
        />
      </div>
    );
  }

  return (
    // ⚠ NOT `.page-float` (Samuel, 2026-08-27). That recipe floats a rounded, bordered,
    // shadowed card inside a margin — right for a PAGE in the app shell, wrong for a window
    // whose whole viewport is this content: it read as a panel hovering on a background, with
    // inner corners cutting across the OS window's own. The window IS the panel; the rounding
    // belongs to the operating system. Fill only, and it is `.page-float`'s own colour.
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--panel-surface)] antialiased">
      <AgentWindowHeader agent={agent} />
      {/* ⚠ ONE BOX, NOT TWO (Samuel, 2026-08-27). The usage strip sat directly above the three
          dropdowns — two stacked bands about one agent. It renders INSIDE the posture box now,
          under the controls. */}
      {agent ? (
        <PostureControls
          agent={agent}
          channelId={channelId}
          taskId={taskId}
          stats={<AgentWindowStats agent={agent} />}
        />
      ) : null}
      {/* ⚠ THE SAME STREAM THE SLIDE-OUT PANEL RENDERS (2026-08-22), shared
          rather than forked — `agent-stream.tsx` carries the lane rules. The
          window is this content at a comfortable width; the panel is the glance
          at it. Two renderers for one set of facts is two vocabularies for them. */}
      <AgentStream
        entries={entries}
        supported={supported}
        sent={sent}
        // ⚠ THE HELD-DRAFT CARD IS DECIDABLE HERE TOO (Samuel, 2026-08-25). The
        // window and the slide-out panel share one stream, so they must share
        // the one review surface as well — a card that could only be posted from
        // the panel would be a second rule for the same box.
        // ⚠ THE UNFILTERED TRANSCRIPT — the landing check cannot use `sent`,
        // which is agent-scoped on a key a threadless post does not have.
        delivered={messages}
        pending={pendingPosts}
        onPost={(id) => consent.mutate({ id, decision: "allow" })}
        postBusy={consent.pending}
        threadTitle={agent?.threadTitle}
        viewer={viewer}
        className="px-4"
      />
      {/* ⚠ THE COMPOSER IS SHARED WITH THE SLIDE-OUT PANEL (2026-08-22) —
          `agent-composer.tsx`, extracted from this file rather than copied into
          that one. One send path, one refusal vocabulary, one feature detection.
          ⚠ `agent.agentId` names WHICH instance: this window's ROUTE carries only
          `(channel, thread)`, which since multiplayer is a GROUP, so the id off
          the resolved summary is the only thing that says which agent the
          operator is actually looking at. */}
      <AgentComposer
        channelId={channelId}
        taskId={taskId}
        agentId={agent?.agentId}
        name={agent ? agentDisplayName(agent) : null}
        // ⚠ THE WINDOW GOES READ-ONLY, IT DOES NOT GO AWAY. An ended agent's
        // history is retained and this is where it is read; only the input goes.
        ended={agent?.state === "ended"}
        className="px-4"
      />
    </div>
  );
}

function AgentWindowHeader({ agent }: { agent: DesktopSessionSummary | null }) {
  return (
    <header className="flex h-[56px] shrink-0 items-center gap-2 border-b border-border-default px-4">
      <Bot size={15} aria-hidden className="shrink-0 text-text-secondary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-text-primary">
          {agent ? agentDisplayName(agent) : "Agent"}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-caption text-text-secondary">
          <CornerDownRight size={11} aria-hidden className="shrink-0 text-text-muted" />
          <span className="truncate">in {agent?.threadTitle ?? NO_THREAD_LABEL}</span>
        </span>
      </span>
      {agent &&
        (agent.state === "ended" ? (
          <AgentEndedPill />
        ) : (
          <AgentLiveness {...agentLiveness(agent)} />
        ))}
    </header>
  );
}

/** ⚠ Absences render AS absences — no denominator, no stamp, no clause. Never a zero standing in
 *  for "not measured" (INVARIANTS §11). Same rule as the panel's strip.
 *  ⚠ THIS SAID "no denominator, NO METER" until 2026-08-28, and the second half had been reversed
 *  a day earlier: the 2026-08-27 ruling renders the BAR unconditionally, at 0, so a spawn-idle
 *  agent gets a box instead of nothing. The docblock kept the retired rule twenty lines above the
 *  call that breaks it. What survives — and what `shared/ui/usage-meter.tsx` now genuinely
 *  enforces rather than being credited with — is the DENOMINATOR half: no window reported, no
 *  `/ 0k` printed beside a number that is real. */
function AgentWindowStats({ agent }: { agent: DesktopSessionSummary | null }) {
  if (!agent) return null;
  const used = metric(agent.contextUsed);
  const window = metric(agent.contextWindow);
  const spent = metric(agent.tokensSpent);
  const lastAt = metric(agent.lastActivityAt);
  const line = [
    spent !== null && `${formatTokens(spent)} tokens spent`,
    lastAt !== null &&
      `Last activity ${formatRelativeTime(new Date(lastAt).toISOString())}`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-1.5">
      {/* ⚠ THE BAR AT ZERO, ALWAYS — same ruling as the pane's (Samuel, 2026-08-27). It was
          gated on a reported `contextWindow`, which a spawn-idle agent does not have, so the box
          rendered nothing at all. `UsageMeter` handles the missing denominator itself (empty
          track, no division), so this is one unconditional call. */}
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
