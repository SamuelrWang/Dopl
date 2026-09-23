"use client";

/**
 * The right panel's Agents tab: every member's live agents. Mine come from this machine's session feed
 * (with context/token numbers the server never stores); peers' from the server projection, read-only.
 * Copy says "agent", never "session" (INVARIANTS §5). Needs a `QueryClientProvider`.
 */

import { useMemo } from "react";
import { ChevronDown, Plus } from "lucide-react";
import {
  IdentityLaunchPicker,
  useIdentityPicker,
} from "@/features/agent-identities/components/identity-picker";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { cn } from "@/shared/lib/utils";
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";
import { useChannelLaunchPosture } from "../hooks/use-channel-launch-posture";
import type { AgentColorKey, ChannelMember } from "../types";
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
import type { AgentLaunchControls, LaunchAgentFn } from "./use-launch-controls";

/** With no launch act the tab answers `no-bridge`, never an invented success. */
const refuseNoBridge = async () => ({ ok: false, reason: "no-bridge" });
const approveNoBridge = async () => ({ ok: false, reason: "no-bridge" });


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
  onApproveIdentity,
  openAgent,
  onOpenAgent,
  // `onNewThread` is accepted but not destructured (SPA `noUnusedLocals`).
}: {
  /** This machine's feed, or `null` for "could not ask" (no bridge) — never collapse to `[]`. */
  sessions: readonly DesktopSessionSummary[] | null;
  channelId: string;
  /** The identity picker's input; absent ⇒ no chevron. */
  workspaceId?: string | null;
  /** Scopes the tab: a thread's agents, or (null) the whole channel's. */
  openThreadId?: string | null;
  members?: ChannelMember[];
  currentUserId?: string | null;
  /** The unfiltered channel projection (my own rows included); peers render read-only. */
  peers?: readonly ChannelPeerSession[];
  canLaunch?: boolean;
  launchBusy?: boolean;
  /** Copy for the last refused launch (`use-launch-controls.ts › launchRefusalText`), or null. */
  launchError?: string | null;
  /** Branded `LaunchAgentFn`, passed through unwrapped: a narrower wrapper dropped agentId/runtime/colour (P6-01). */
  onLaunchAgent?: LaunchAgentFn;
  /** Stores a first-use approval of another member's identity; absent ⇒ the modal says it can't be remembered. */
  onApproveIdentity?: (identityId: string) => Promise<{ ok: boolean; reason?: string }>;
  /** `agentKey(session)` of the open agent view, or null. */
  openAgent: string | null;
  onOpenAgent: (key: string) => void;
  /** Inert here but kept: `agents-tab-launch.test.tsx` asserts it is never called. */
  onNewThread?: () => void;
}) {
  const byUser = new Map(members.map((m) => [m.userId, m]));
  const me = currentUserId ? (byUser.get(currentUserId) ?? null) : null;
  // Hooks stay above the `sessions === null` early return.
  const picker = useIdentityPicker();
  const launch = useAgentLaunch();
  const { catalogs } = useChannelLaunchPosture(channelId);
  // Channel roster, not workspace: an outside author degrades to "by another member" (`identity-picker.tsx › authorMarker`).
  // No `useMemo`: it makes the React Compiler bail on this component.
  const memberNames = new Map(
    members.map((m) => [m.userId, m.displayName || m.email || ""] as const)
  );

  // Not a second launch path: `onLaunchAgent` is passed through, never re-wrapped.
  const launchControls: AgentLaunchControls = useMemo(
    () => ({
      canLaunch,
      launchBusy,
      launchError,
      launchAgent: onLaunchAgent ?? refuseNoBridge,
      approveIdentity: onApproveIdentity ?? approveNoBridge,
    }),
    [canLaunch, launchBusy, launchError, onLaunchAgent, onApproveIdentity]
  );
  // Shared with the tab badge's count — never inline this filter.
  const peerCards = peerCardsFor(peers, currentUserId, openThreadId);

  // Server-assigned colour off the unfiltered projection, keyed by minted instance id; no `useMemo` (compiler bail).
  const colorOf = (agentId: string | null | undefined): AgentColorKey | null =>
    (agentId && peers.find((p) => p.name === agentId)?.color) || null;

  // Split button: "New agent" opens the form; the chevron picks an identity and opens the same form.
  const launchRow = canLaunch && onLaunchAgent && (
    <div className="mb-3">
      <div className="flex justify-end">
        {/* Composes `TAB_ACTION`'s halves: one class string can't express a split button. */}
        <div className={cn(TAB_ACTION_SHELL, "items-stretch overflow-hidden")}>
          <button
            type="button"
            disabled={launchBusy}
            title={
              openThreadId
                ? undefined
                : "Starts an agent on the channel"
            }
            // `toggle` mints the instance id the form shows.
            onClick={() => launch.toggle()}
            className={cn(
              "flex min-w-0 cursor-pointer items-center disabled:opacity-60",
              TAB_ACTION_INK
            )}
          >
            <Plus size={13} aria-hidden />
            {launchBusy ? "Starting\u2026" : "New agent"}
          </button>
          {workspaceId && (
            <>
              <span aria-hidden className="w-px shrink-0 self-stretch bg-white/25" />
              <button
                type="button"
                disabled={launchBusy}
                onClick={(e) => picker.toggleFrom(e.currentTarget)}
                aria-haspopup="menu"
                aria-expanded={picker.open}
                // Distinct name: two controls sharing one read as one to a screen reader.
                aria-label="Launch from identity"
                // w-8: over the 24px hit-target floor.
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
      {/* `currentUserId ?? ""` fails closed: every identity wears the authorship marker (INVARIANTS §5A). */}
      <LaunchAgentDialog
        panel={launch}
        newAgent={launchControls}
        /* Unfiltered `peers`: colours are unique across my own agents too (advisory; the DB index decides). */
        liveSessions={peers}
        openThreadId={openThreadId ?? null}
        channelId={channelId}
        workspaceId={workspaceId}
        currentUserId={currentUserId ?? ""}
        members={members}
      />
      {workspaceId && (
        <IdentityLaunchPicker
          open={picker.open}
          at={picker.at}
          onClose={picker.close}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          memberNames={memberNames}
          busy={launchBusy}
          /* Picks only; the form opens preselected (`null` = blank) and launches. */
          onPick={(identity) => launch.openWithIdentity?.(identity)}
        />
      )}
    </div>
  );

  if (sessions === null) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
        {/* No bridge = own agents unknown (§11), so no empty wells here — they'd read as "no agents". */}
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

  // Shared with the tab badge's count.
  const mine = ownAgentsFor(sessions, channelId, openThreadId);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
      {launchRow}
      {
        // Order is the data: my own agents first (§5), then peers.
        <AgentWells
          items={[
            ...mine.map((agent) => ({
              key: agentKey(agent),
              at: agentActivityAt(agent),
              node: (
                <AgentCard
                  agent={agent}
                  // Server's key, never `agent.color` (that is only this machine's request).
                  color={colorOf(agent.agentId)}
                  catalogs={catalogs}
                  owner={me}
                  viewing={agentKey(agent) === openAgent}
                  onOpen={() => onOpenAgent(agentKey(agent))}
                />
              ),
            })),
            ...peerWellItems(peerCards, byUser),
          ]}
        />
      }
      {/* Time-span headings can't say whether the channel or the thread is empty; this line does. */}
      {mine.length === 0 && peerCards.length === 0 && (
        <p className="py-6 text-center text-caption text-text-muted">
          {openThreadId
            ? "No agents on this thread yet."
            : "No agents running in this channel."}
        </p>
      )}
    </div>
  );
}

/** One `PeerCards` per row, so the peer card's face keeps one entry point; key matches `PeerCards`'. */
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
