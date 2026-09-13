"use client";

/**
 * Channels v2 — the right panel's AGENTS tab: MY agents running in this
 * channel, one card each, each with a way into the agent view.
 *
 * Every card is one live entry from this machine's own session projection —
 * `agents-model.ts`, over `spa-bridge.ts › DesktopSessionSummary` — including the
 * context and token numbers, which the desktop measures and the server stores
 * none of (INVARIANTS §5's Agents-tab bullet). It is therefore an OPERATOR
 * surface, not a roster: another member's agent cannot appear here, and the Info
 * tab's Members list is where everyone's presence lives.
 *
 * ⚠ DESKTOP-ONLY, AND IT SAYS SO RATHER THAN SHOWING NOTHING. "Could not ask" and
 * "asked, nothing is running" are different facts and are worded differently — an
 * empty list under a browser would read as "you have no agents", which is a claim
 * this surface cannot make.
 *
 * ⚠ COPY RULE (INVARIANTS §5): the noun on this surface is the AGENT. Inside one
 * member's window there is exactly ONE session, so nothing here writes "agent
 * session" or "channel session".
 *
 * ⚠ **IT REQUIRES A `QueryClientProvider` SINCE 2026-09-08**, unconditionally.
 * `launch-agent-dialog.tsx › LaunchAgentDialog` is mounted with the ROW rather
 * than with its own open state, so the popup keeps `ModalShell`'s fade-OUT; the
 * cost is that its template `useQuery` exists (disabled, fetching nothing) while
 * the form is shut, and TanStack still wants the provider.
 *
 * ⚠ "AGENTS" NAMES TWO DIFFERENT SURFACES AND BOTH NAMES STAY (Samuel's ruling
 * Q6, 2026-08-26; INVARIANTS §5A). THIS tab is the RUNNING SESSIONS — ephemeral,
 * per-operator. The /home **Agents** face (`apps/desktop-ui/src/pages/home/
 * agent-panels.tsx`) is TEMPLATE IDENTITIES, durable and authored, and has no
 * launch control precisely so this side stays the only place an agent starts.
 * They join at `agent-templates/components/template-picker.tsx ›
 * TemplateLaunchPicker` below, which reads the list the /home face authors.
 * **A rename needs Samuel's word** — §5's noun rule has tests behind it.
 */

import { useMemo } from "react";
import { ChevronDown, Plus } from "lucide-react";
import {
  TemplateLaunchPicker,
  useTemplatePicker,
} from "@/features/agent-templates/components/template-picker";
import type { TemplateLaunchOverrides } from "@/features/agent-templates/lib/launch-overrides";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { cn } from "@/shared/lib/utils";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import type { AgentColorKey, ChannelMember } from "../../types";
import { TAB_ACTION_INK, TAB_ACTION_SHELL } from "./bits";
import { AgentCard, PeerCards } from "./agents-tab-cards";
import {
  agentKey,
  ownAgentsFor,
  peerCardsFor,
} from "./agents-model";
import {
  AgentWells,
  agentActivityAt,
  peerActivityAt,
  type AgentWellItem,
} from "./agents-wells";
import { LaunchAgentDialog } from "./launch-agent-dialog";
import { useAgentLaunch } from "./use-agent-launch";
import type { AgentLaunchControls, AgentLaunchOutcome } from "./use-agents-panel";


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
  // ⚠ `onNewThread` IS ACCEPTED AND NOT DESTRUCTURED — binding an unused local is
  // an ERROR under the SPA's `noUnusedLocals`. See its docblock below.
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
  /** The New Agent button — BOTH views, desktop only (the "thread view only"
   *  claim died with the redirect on 2026-08-31; the chevron beside it joined
   *  it on 2026-09-08). */
  canLaunch?: boolean;
  launchBusy?: boolean;
  /** Copy for the last launch main REFUSED, or null. ⚠ A refusal is not a
   *  push — nothing announces it, so the button's own row is the only place it
   *  can be said (`use-agents-panel.ts › launchRefusalText`). */
  launchError?: string | null;
  /**
   * ⚠ THE ZERO-TEMPLATE CALL IS THE PINNED ONE. `onLaunchAgent(threadId)` is what
   * the New Agent button does in ONE CLICK; the optional arguments are the
   * picker's and the popup's (Samuel's "one lane, one-click launch" ruling — the
   * picker never intercepts the button).
   * ⚠ `null` IS A CHANNEL-LEVEL LAUNCH (Samuel, 2026-08-31) — an agent on the
   * ROOM, the threadless lane the composer's Bot icon has had since 2026-08-21;
   * no counterparty is not a refusal (`use-agents-panel.ts`).
   */
  onLaunchAgent?: (
    threadId: string | null,
    templateId?: string | null,
    overrides?: TemplateLaunchOverrides,
    /** ⚠ THE POPUP'S TWO EXTRA ARGUMENTS (2026-09-08) — the pre-assigned id and the
     *  per-spawn runtime `use-agents-panel.ts › launchAgent` has taken since
     *  2026-08-27/08-31. The picker's shorter calls are unchanged. */
    agentId?: string,
    runtime?: string,
    /** ⚠ THE POPUP'S THIRD EXTRA ARGUMENT (2026-09-13, agent colours) — the colour key, on
     *  `runtime`'s exact argument. Absent means the server assigns the first free one, never
     *  "no colour"; the picker's shorter calls stay unchanged. */
    color?: AgentColorKey
  ) => Promise<AgentLaunchOutcome> | void;
  /** Store a first-use approval for another member's template, machine-locally.
   *  ⚠ Absent ⇒ the approval modal says the build cannot remember it, rather
   *  than looping on a refusal it can never clear. */
  onApproveTemplate?: (templateId: string) => Promise<{ ok: boolean; reason?: string }>;
  /** `agentKey(session)` of the open agent view, or null. */
  openAgent: string | null;
  onOpenAgent: (key: string) => void;
  /**
   * Opens the composer's new-thread panel.
   *
   * 🔒 **INERT ON THIS TAB SINCE 2026-08-31 AND DELIBERATELY STILL ACCEPTED.** It
   * was the launch button's "make a thread first" redirect, which Samuel's
   * channel-level-launch ruling deleted. ⚠ **Do not "finish the job" by removing
   * the prop**: `info-panel.tsx` passes it to both mounts, and
   * `agents-tab-launch.test.tsx` pins that it is NOT called — the assertion that
   * would go silent if the prop stopped being accepted.
   */
  onNewThread?: () => void;
}) {
  const byUser = new Map(members.map((m) => [m.userId, m]));
  const me = currentUserId ? (byUser.get(currentUserId) ?? null) : null;
  // ⚠ CALLED UNCONDITIONALLY, ABOVE EVERY EARLY RETURN. The tab bails out for a
  // browser (`sessions === null`) further down, and a hook behind that branch is
  // a hook-order violation on the very first desktop render.
  const picker = useTemplatePicker();
  // ⚠ SAME RULE, SAME REASON — the popup's own state, above every early return.
  const launch = useAgentLaunch();
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
    threadId: string | null,
    templateId: string | null,
    overrides?: TemplateLaunchOverrides
  ): Promise<AgentLaunchOutcome> {
    const res = await onLaunchAgent?.(threadId, templateId, overrides);
    return res ?? { ok: false, reason: "no-bridge" };
  }

  /**
   * THE POPUP'S CONTROLS, ASSEMBLED FROM THE FLAT PROPS THIS TAB ALREADY TAKES.
   *
   * ⚠ NOT A SECOND LAUNCH PATH — every face reaches `use-agents-panel.ts ›
   * launchAgent` through `onLaunchAgent`. ⚠ AND IT NEVER INVENTS A SUCCESS, for
   * the reason {@link launchFromPicker} states.
   */
  const launchControls: AgentLaunchControls = useMemo(
    () => ({
      canLaunch,
      launchBusy,
      launchError,
      // ⚠ SIX ARGUMENTS, SPELLED OUT — NOT ROUTED THROUGH {@link launchFromPicker}, whose
      // THREE-argument payload `agents-tab-launch.test.tsx` pins argument for argument.
      // ⚠ **SPELLED OUT RATHER THAN `(...args) => onLaunchAgent?.(...args)`, AND THAT IS THE
      // POINT OF THE COUNT BEING IN THIS COMMENT**: a rest-spread would forward a seventh
      // argument nobody had declared, and the failure mode of this lane is a field that LOOKS
      // wired and sends nothing (2026-09-13: `color` was the sixth to be added this way).
      launchAgent: async (threadId, templateId, overrides, agentId, runtime, color) => {
        const res = await onLaunchAgent?.(
          threadId,
          templateId,
          overrides,
          agentId,
          runtime,
          color
        );
        return res ?? { ok: false, reason: "no-bridge" as const };
      },
      approveTemplate: async (templateId: string) =>
        (await onApproveTemplate?.(templateId)) ?? { ok: false, reason: "no-bridge" },
    }),
    [canLaunch, launchBusy, launchError, onLaunchAgent, onApproveTemplate]
  );
  // Peers: other members' live rows, thread-scoped like everything on the tab.
  // Own rows are excluded — the LOCAL feed below is the richer truth for mine.
  // ⚠ THE PREDICATE IS `agents-model.ts › peerCardsFor`, NOT AN INLINE FILTER
  // (2026-08-20): the tab-row badge counts the same rows this list draws, and a
  // second copy of the rule is how a badge comes to say 3 over a list of 2.
  const peerCards = peerCardsFor(peers, currentUserId, openThreadId);

  /**
   * NEW AGENT — the 36px page button that OPENS THE POPUP (2026-09-08).
   *
   * ⚠ **THIS SUPERSEDES THE ONE-CLICK FACE OF 2026-08-22.** Samuel, verbatim: *"i want to make a
   * pop up for the threads creation as well. And put in the new agent button in the agents tab."*
   * The popup is preselected to Blank agent, so the same launch is one click plus one Launch.
   * **There is still exactly ONE launch lane**: it submits through `onLaunchAgent`, the prop the
   * face called and the chevron still calls.
   *
   * ⚠ THE CHEVRON IS UNTOUCHED — `TemplateLaunchPicker` is its own adjacent hit target with its
   * own accessible name, never a menu in front of the button.
   * ⚠ BOTH VIEWS GO THROUGH IT, reading `openThreadId ?? null`: thread view lands the agent on
   * that exchange, channel view on the ROOM (2026-08-31, the channel-level lane).
   * ⚠ THE ONLY GATES ARE `canLaunch` (feature detection over the bridge) and a launch already in
   * flight. `workspaceId` gates the CHEVRON and the popup's template roster — not the button.
   */
  const launchRow = canLaunch && onLaunchAgent && (
    <div className="mb-3">
      <div className="flex justify-end">
        {/* ⚠ IT CANNOT BE `TAB_ACTION` — a split button is a wrapper plus two hit
            targets, and one class string cannot express that. It COMPOSES that
            constant's two halves (`bits.tsx › TAB_ACTION_SHELL` / `TAB_ACTION_INK`)
            rather than re-cutting the geometry, so the two cannot drift. */}
        <div className={cn(TAB_ACTION_SHELL, "items-stretch overflow-hidden")}>
          <button
            type="button"
            disabled={launchBusy}
            title={
              openThreadId
                ? undefined
                : "Starts an agent on the channel"
            }
            // ⚠ IT OPENS THE FORM; IT DOES NOT LAUNCH (2026-09-08 — see the block above).
            // `toggle` is the opener because it is what MINTS the instance id the form shows.
            onClick={() => launch.toggle()}
            className={cn(
              "flex min-w-0 cursor-pointer items-center disabled:opacity-60",
              TAB_ACTION_INK
            )}
          >
            <Plus size={13} aria-hidden />
            {launchBusy ? "Starting\u2026" : "New agent"}
          </button>
          {/* ⚠ THE CHEVRON IS ON BOTH VIEWS SINCE 2026-09-08 (Samuel: *"Same
              one, that enables me to launch a template"*) — the last piece of the
              redirect the 2026-08-31 ruling deleted. A template launch is the same
              lane as a blank one, so with no thread open it starts on the ROOM.
              The only gate left is `workspaceId`: feature detection over a READ,
              since a picker with no workspace to list can only be empty. */}
          {workspaceId && (
            <>
              {/* The hairline is what makes the pair read as ONE control with two
                  zones rather than two buttons that happen to touch. */}
              <span aria-hidden className="w-px shrink-0 self-stretch bg-white/25" />
              <button
                type="button"
                disabled={launchBusy}
                onClick={(e) => picker.toggleFrom(e.currentTarget)}
                aria-haspopup="menu"
                aria-expanded={picker.open}
                // \u26a0 ITS OWN NAME, never the launch button's \u2014 two controls
                // sharing an accessible name are one control to a screen reader,
                // and the point of the split is that they are two.
                aria-label="Launch from template"
                // w-8 = 32px, over the 24px floor Samuel set for this zone.
                className="flex w-8 shrink-0 cursor-pointer items-center justify-center text-text-on-cta/75 transition-colors hover:text-text-on-cta disabled:opacity-60"
              >
                <ChevronDown size={13} aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>
      {launchError && (
        <p role="alert" className="mt-1.5 px-0.5 text-caption text-danger">
          {launchError}
        </p>
      )}
      {/* ⚠ THE FORM ITSELF. Mounted with the ROW rather than with the button, so the popup and
          the refusal line it may print live in one place. `currentUserId ?? ""` is FAIL-CLOSED:
          with no viewer id every template wears the authorship marker (INVARIANTS §5A) rather
          than none of them silently reading as mine. */}
      <LaunchAgentDialog
        panel={launch}
        newAgent={launchControls}
        /* ⚠ **THE TAKEN SET, AND `peers` IS THE RIGHT SOURCE PRECISELY BECAUSE IT IS NOT
           FILTERED** (2026-09-13; docs/specs/agent-colors.md item 7). This prop is the WHOLE
           channel projection — every member's live rows, the operator's own included — and the
           own-exclusion this tab applies happens downstream, in `peerCardsFor` for the CARDS.
           A colour is unique across members AND across one operator's own agents, so the
           unfiltered set is exactly what the circles must grey out; handing `peerCards` here
           would let the operator pick the key their own other agent is already wearing.
           ⚠ ITS `color` RIDES `ChannelSessionState` (peer-visible by design), so this costs no
           new read — and the popup's answer is advisory either way: uniqueness is decided by
           `20261005120000`'s index, never by this list. */
        liveSessions={peers}
        openThreadId={openThreadId ?? null}
        channelId={channelId}
        workspaceId={workspaceId}
        currentUserId={currentUserId ?? ""}
        members={members}
      />
      {workspaceId && (
        <TemplateLaunchPicker
          open={picker.open}
          at={picker.at}
          onClose={picker.close}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          memberNames={memberNames}
          busy={launchBusy}
          // ⚠ `openThreadId ?? null` — BYTE-FOR-BYTE THE FACE'S OWN ARGUMENT.
          // The two halves of the split button must not disagree about where
          // they launch, so the thread is read the same way on both.
          launch={(templateId, overrides) =>
            launchFromPicker(openThreadId ?? null, templateId, overrides)
          }
          approve={onApproveTemplate}
        />
      )}
    </div>
  );

  if (sessions === null) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
        {/* ⚠ THE SAME WELLS HERE — a peer card is an agent card and Samuel's
            ruling is about the PAGE, so the one list this branch can show sits on
            the same gray ground. With no peers nothing renders and the sentence
            below stands alone, exactly as before. */}
        {peerCards.length > 0 && (
          <AgentWells items={peerWellItems(peerCards, byUser)} />
        )}
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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
      {launchRow}
      {mine.length === 0 && peerCards.length === 0 ? (
        <p className="py-6 text-center text-caption text-text-muted">
          {openThreadId
            ? "No agents on this thread yet."
            : "No agents running in this channel."}
        </p>
      ) : (
        // ⚠ THE FOUR GRAY WELLS (Samuel, 2026-09-13) — `agents-wells.tsx` owns the
        // buckets, the collapse and the ground; this call owns only the ORDER, which
        // is unchanged: my own agents first (§5), then the peer rows, each card
        // exactly the component it was.
        <AgentWells
          items={[
            ...mine.map((agent) => ({
              key: agentKey(agent),
              at: agentActivityAt(agent),
              node: (
                <AgentCard
                  agent={agent}
                  owner={me}
                  viewing={agentKey(agent) === openAgent}
                  onOpen={() => onOpenAgent(agentKey(agent))}
                />
              ),
            })),
            ...peerWellItems(peerCards, byUser),
          ]}
        />
      )}
    </div>
  );
}

/**
 * THE PEER ROWS AS WELL ITEMS.
 *
 * ⚠ **`PeerCards` IS CALLED WITH ONE ROW AT A TIME RATHER THAN SPLIT INTO A
 * SINGLE-CARD EXPORT.** That component owns the peer card's whole face — the
 * avatar fallback, the staleness dimming and its `data-stale` hook, the
 * no-timestamp rule (Samuel, 2026-09-04) — and a second entry point into it is a
 * second place for that face to drift. A one-element list renders one card and
 * nothing else.
 * ⚠ **THE KEY IS THE ONE `PeerCards` ALREADY MINTS** (`user:name:thread`), so a
 * peer row keeps its React identity across a regroup.
 */
function peerWellItems(
  peers: readonly ChannelPeerSession[],
  byUser: ReadonlyMap<string, ChannelMember>
): AgentWellItem[] {
  return peers.map((peer) => ({
    key: `peer:${peer.userId}:${peer.name}:${peer.threadId ?? ""}`,
    at: peerActivityAt(peer),
    node: <PeerCards peers={[peer]} byUser={byUser} />,
  }));
}
