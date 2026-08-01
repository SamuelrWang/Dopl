"use client";

import { useWorkspaceTablesRealtime } from "@/shared/realtime/use-workspace-tables-realtime";
import {
  AGENT_TABLES,
  CHANNEL_TABLES,
  CONSENT_TABLES,
  PRESENCE_TABLES,
} from "../constants";

/**
 * THE TABLE THAT IS NOT WATCHED, and why there is no hook for it below.
 *
 * `channel_task_participants` — the "who is in this thread" set behind the rooms
 * sidebar's agent pills — is deliberately OUT of the realtime publication.
 * Migration 20260731130000 says so in as many words, on the F-072 grounds that
 * publishing a rarely-changing child table re-creates read amplification for no
 * live benefit (the same call 20260728010000 made when it pulled `channel_tasks`
 * back out). There is therefore no stream to subscribe to from here: a
 * `useWorkspaceTablesRealtime` call naming it would register a channel that
 * never delivers an event, which is WORSE than no subscription, because it
 * looks like coverage. Publishing it is a migration plus a publication
 * decision, not a client change, and neither belongs in this file.
 *
 * THE CONSEQUENCE, STATED RATHER THAN HIDDEN: the participant set refreshes
 * only when the thread list refetches (any `channel_messages` event coalesces
 * one), so a second agent that joins a thread WITHOUT posting leaves the pills
 * a beat behind. `lib/thread-agents.ts#threadAgentsLabel` carries that caveat
 * in the row's own copy, so the sidebar never presents the set as live.
 */

/**
 * Realtime refetch signal for the channels tables of a workspace. Fires
 * `onChange` on any channels / channel_members / channel_messages event —
 * the view refetches through the filtered service (RLS + service filters
 * stay authoritative), never merging the raw payload.
 */
export function useChannelsRealtime(
  workspaceId: string | null | undefined,
  onChange: () => void
): void {
  useWorkspaceTablesRealtime(
    workspaceId,
    CHANNEL_TABLES,
    "channels-realtime",
    onChange
  );
}

/**
 * Realtime signal for the consent inbox. Watched separately from the channel
 * tables so an inbound / outbound request appearing (or being decided on
 * another surface) refetches ONLY the consent inbox — RLS already scopes the
 * stream to the operator's own rows. Used by both the channels page and the
 * always-mounted sidebar badge.
 */
export function useConsentRealtime(
  workspaceId: string | null | undefined,
  onChange: () => void
): void {
  useWorkspaceTablesRealtime(
    workspaceId,
    CONSENT_TABLES,
    "channels-consent-realtime",
    onChange
  );
}

/**
 * Realtime signal for the channel's agent roster. `channel_agents` is in the
 * publication (migration 20260731120000), and every write to it happens
 * service-side (`/new-agent` from either machine, a desktop session flipping an
 * agent to `active`, a park), so the chips bar only ever learns about them this
 * way. Watched separately from CHANNEL_TABLES so a status flip refetches the
 * agent list alone, not the whole channel list.
 *
 * IT DOES NOT COVER EXPIRY. `engaged_at` is a stamp the server never clears on
 * a timer, so an agent falling out of the engagement window produces no row
 * change and therefore no event here. The chips bar schedules its own wake for
 * that (`components/agent-chips-bar.tsx#useEngagementClock`); this stream and
 * that clock are the two halves of a chip that stays true.
 */
export function useChannelAgentsRealtime(
  workspaceId: string | null | undefined,
  onChange: () => void
): void {
  useWorkspaceTablesRealtime(
    workspaceId,
    AGENT_TABLES,
    "channels-agents-realtime",
    onChange
  );
}

/**
 * Realtime signal for agent presence. A heartbeat firing every ~30s per
 * listener is high-churn, so it gets its own subscription — a presence event
 * refetches only the presence-derived views (online dots / counts), not the
 * whole channel list.
 */
export function usePresenceRealtime(
  workspaceId: string | null | undefined,
  onChange: () => void
): void {
  useWorkspaceTablesRealtime(
    workspaceId,
    PRESENCE_TABLES,
    "channels-presence-realtime",
    onChange
  );
}
