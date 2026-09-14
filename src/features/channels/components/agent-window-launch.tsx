"use client";

/**
 * THE "+" TAB'S FORM — New agent, from inside the agent window (2026-09-13).
 *
 * 🔒 **SAMUEL, over Wispr Flow's pop-out:** *"You see there's a little X button, so you can see I
 * can add a new tab, stuff like that."* The tab-strip ruling gave the strip a `+` whose job is *"a
 * new agent on the ACTIVE tab's channel"* — and until this file existed **the `+` reported a click
 * nobody listened to**: no host mounted a dialog, so the one control on that row that promises a new
 * agent did nothing at all. That is §11's silent-feature shape, on a control the operator can see.
 *
 * ⚠ **IT IS THE SAME DIALOG AND THE SAME LAUNCH LANE, NOT A THIRD ONE.**
 * `launch-agent-dialog.tsx › LaunchAgentDialog` is mounted here exactly as `agents-tab.tsx` mounts
 * it — same component, same `useAgentLaunch` panel, same `templateId`-not-a-snapshot payload. The
 * wiring is copied from that file deliberately: INVARIANTS §5A's *"there is still exactly ONE launch
 * lane"* is a rule about the LANE, and a second form for one lane is how two vocabularies start.
 *
 * ⚠ **WHAT IT DOES NOT COPY IS THE PROP CHAIN, BECAUSE THIS WINDOW HAS NO PAGE ABOVE IT.** The
 * Agents tab is handed `onLaunchAgent` / `onApproveTemplate` down from the channels page's
 * `useAgentsPanel`; the pop-out is a different `BrowserWindow` with a different React tree and
 * inherits nothing. So the controls are built HERE over `agents-controls.ts` — the same module
 * `useAgentsPanel` itself calls — rather than by mounting that hook, which would also drag a peer
 * poll and a roster into a window whose whole diet is messages + consent.
 *
 * ⚠ **THE DIALOG PORTALS TO `document.body`** (`settings-modal/modal-shell.tsx › createPortal`), so
 * it is not clipped by the inset panel's `overflow-hidden` and this component can be mounted
 * anywhere in the window's tree.
 */

import { useMemo } from "react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { agentColorOrNull } from "../lib/agent-colors";
import { LaunchAgentDialog } from "./launch-agent-dialog";
import type { AgentLaunchPanel } from "./use-agent-launch";
import type { AgentLaunchControls } from "./use-agents-panel";
import {
  approveTemplate,
  canLaunchAgents,
  launchAgentOnThread,
} from "./agents-controls";

/**
 * ⚠ **EMPTY, AND THAT IS THE MEASURED ANSWER RATHER THAN A SHORTCUT.** `members` feeds ONE thing:
 * the NAME half of a foreign template's authorship marker (`template-picker.tsx › authorMarker`).
 * With no roster, a template this operator did not create still reads **`by another member`** — the
 * marker survives, which is the direction INVARIANTS §5A requires (dropping it would turn UNKNOWN
 * into MINE); only the name is lost. The alternative is mounting `useChannelMembers` here, which
 * adds a roster request AND a 60s presence backstop poll to a window that deliberately has neither
 * — a poll, for a name on a marker. If a ruling ever asks for the names, the roster is the change.
 */
const NO_ROSTER: ReadonlyArray<{
  userId: string;
  displayName: string | null;
  email: string | null;
}> = [];

/** ⚠ ONE OBJECT AT MODULE SCOPE, so a browser's `null` feed hands the same array every render and
 *  the memo below does not rebuild the taken set per keystroke in the popup's Name field. */
const NO_SESSIONS: ReadonlyArray<DesktopSessionSummary> = [];

/**
 * The `+`'s dialog, for the ACTIVE tab's channel.
 *
 * ⚠ **THE PANEL IS THE HOST'S STATE, NOT THIS COMPONENT'S** — the `+` lives in the chrome and the
 * form lives here, so the one thing they share (is it open) has to be owned above both. Same shape
 * as the tab set itself.
 */
export function AgentWindowLaunch({
  panel,
  workspaceId,
  currentUserId,
  channelId,
  taskId,
  sessions = NO_SESSIONS,
  agent,
}: {
  panel: AgentLaunchPanel;
  workspaceId: string;
  currentUserId: string;
  channelId: string;
  /** The ACTIVE tab's thread. ⚠ `""` means this tab's agent has no first-class thread, and the new
   *  agent then starts on the ROOM — `null` on the wire, which is the channel-level lane. */
  taskId: string;
  /**
   * **THIS MACHINE'S WHOLE SESSION FEED — the colour row's taken set, and the only source this
   * window has for it** (2026-09-13; docs/specs/agent-colors.md item 7).
   *
   * ⚠ **THE OWN FEED IS ADVISORY HERE AND THAT IS THE MEASURED TRADE.** A colour is unique per
   * channel across EVERY member, and this window reads no channel projection — it deliberately has
   * neither a roster request nor a presence poll ({@link NO_ROSTER}) — so what it can fence off is
   * the operator's OWN live agents in this room. A peer's key therefore looks free until the
   * server's partial unique index answers 409 with the free set, which is the same authority that
   * would have corrected it anyway (spec item 3). Fencing the half it KNOWS beats fencing nothing:
   * the common collision is the operator's own second agent.
   * ⚠ **AND THE KEY ON THESE ROWS IS AN ASK, NOT AN ASSIGNMENT** — `spa-bridge-shapes.ts ›
   * DesktopSessionSummary.color` carries that argument in full.
   * ⚠ `null` IS "COULD NOT ASK" (no bridge) and reads as an EMPTY set, which the popup already
   * means by "nothing known to be taken".
   */
  sessions?: readonly DesktopSessionSummary[] | null;
  /**
   * The ACTIVE tab's own feed row, for the room's NAME and the thread's TITLE.
   *
   * ⚠ **IT IS THE ONLY SOURCE THIS WINDOW HAS FOR EITHER**, and that is why the launch reads it
   * rather than a channel record: the pop-out never reads `GET /channels`. `null` (a browser, or an
   * agent that has ended) leaves both empty, which main accepts — they are LABELS on the session.
   * ⚠ **AND IT IS WHY `direct` GOES OUT `false` AND `counterpartyId` `null`**: neither is on
   * `spa-bridge-shapes.ts › DesktopSessionSummary`, so this side genuinely does not know them.
   * Measured: main treats `counterpartyId` as optional and both of them as the OUTBOUND CARD's
   * recipient line (`main/session-launch.js`, `› session-outbound.js`) — so a DM launched from here
   * gets a less specific recipient label, and nothing is mis-routed. It is not guessed `true`.
   */
  agent: DesktopSessionSummary | null;
}) {
  const newAgent: AgentLaunchControls | undefined = useMemo(() => {
    // ⚠ ABSENT, NOT DISABLED, when the bridge cannot launch — `LaunchAgentDialog` takes
    // `newAgent?` for exactly this, and the chrome draws no `+` either (INVARIANTS §11).
    if (!canLaunchAgents()) return undefined;
    return {
      canLaunch: true,
      // ⚠ NO BUSY LIGHT AND NO STICKY ERROR LINE HERE, because there is no hook holding either:
      // `useLaunchRunner` inside the dialog owns the in-flight guard and prints its own refusal.
      // A `false` that never changes is honest; a spinner this file cannot drive would not be.
      launchBusy: false,
      launchError: null,
      // ⚠ **SIX ARGUMENTS, SPELLED OUT, AND THE SIXTH IS WHY THE COUNT IS IN THIS COMMENT**
      // (2026-09-14). `color` was added to `AgentLaunchControls.launchAgent` on 2026-09-13 and
      // this adapter still declared five — TypeScript accepts a narrower implementation of a
      // wider function type, so the operator's colour pick reached here and was DROPPED with no
      // error anywhere: the one row the popup asks this window about was the one row it threw
      // away. The same failure shape `agents-tab.tsx` records beside its own spelled-out six.
      launchAgent: async (threadId, templateId, overrides, agentId, runtime, color) =>
        launchAgentOnThread({
          channelId,
          // ⚠ THE DIALOG'S OWN ARGUMENT, PASSED THROUGH — never re-derived from `taskId` here. The
          // host resolves `openThreadId` once (`""` → `null`), and a second reading of that rule in
          // this callback is how the form and the payload come to disagree about where they launch.
          taskId: threadId,
          workspaceId,
          channelName: agent?.channelName ?? "",
          threadTitle: agent?.threadTitle ?? null,
          counterpartyId: null,
          direct: false,
          templateId,
          overrides,
          agentId,
          runtime,
          // ⚠ ABSENT WHEN THE OPERATOR TOUCHED NO CIRCLE — the server then assigns the first
          // free key, which is what an untouched popup has always meant. Never `null`: the
          // payload's absence IS the spelling of "pick for me".
          color,
        }),
      approveTemplate,
    };
  }, [channelId, workspaceId, agent?.channelName, agent?.threadTitle]);

  /**
   * THIS ROOM'S OWN LIVE AGENTS, in the shape the colour row reads.
   *
   * ⚠ **NARROWED, NOT CAST.** `color` arrives as a plain `string` on the wire shape (a newer
   * desktop may know a seventeenth key), and `lib/agent-colors.ts › agentColorOrNull` is the one
   * membership test — the same gate `lib/live-agents.ts` puts on the peer projection's copy.
   * ⚠ **ENDED ROWS ARE LEFT IN AND `agentColorsTaken` DROPS THEM**, because that function is where
   * Samuel's *"once the agent has ended, that color needs to be returned to the color bank"* lives.
   * A second liveness filter here is a second place for that rule to drift.
   */
  const liveSessions = useMemo(
    () =>
      (sessions ?? []).
        filter((s) => s.channelId === channelId).
        map((s) => ({
          state: s.state,
          color: agentColorOrNull(s.color),
          name: s.name,
          displayName: s.displayName ?? null,
        })),
    [sessions, channelId]
  );

  return (
    <LaunchAgentDialog
      panel={panel}
      newAgent={newAgent}
      liveSessions={liveSessions}
      // ⚠ `""` IS A ROOM, NOT A THREAD (`agents-controls.ts › launchAgentOnThread`: `null` is the
      // channel-level lane, `''` is a legacy responder thread) — so an agent whose exchange never
      // became first-class spawns its sibling on the CHANNEL rather than on a thread that is not
      // addressable.
      openThreadId={taskId || null}
      channelId={channelId}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      members={NO_ROSTER}
    />
  );
}
