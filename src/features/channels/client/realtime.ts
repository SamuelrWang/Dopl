"use client";

import { useWorkspaceTablesRealtime } from "@/shared/realtime/use-workspace-tables-realtime";
import {
  CHANNEL_TABLES,
  CONSENT_TABLES,
  PRESENCE_TABLES,
} from "../constants";

/**
 * THE TABLE THAT IS NOT WATCHED, and why there is no hook for it.
 *
 * `channel_agents` was watched here until the channels rollback (§1): the chips
 * bar learned about a summon, a rename and a status flip only through that
 * stream. Nothing writes the table any more — the one read left is historical
 * attribution — so a subscription to it would deliver nothing forever, and
 * `useChannelAgentsRealtime` is deleted rather than left registering an empty
 * channel. It is still IN the publication (migration 20260731120000); dropping
 * it from there is a migration, and belongs with the later cleanup.
 *
 * A `useWorkspaceTablesRealtime` call naming it would register a channel
 * that never delivers an event, which is WORSE than no subscription because it
 * looks like coverage.
 */

/**
 * Realtime refetch signal for the channels tables of a workspace. Fires
 * `onChange(table)` on any channels / channel_members / channel_messages event —
 * the view refetches through the filtered service (RLS + service filters
 * stay authoritative), never merging the raw payload.
 */
export function useChannelsRealtime(
  workspaceId: string | null | undefined,
  /** `table`: which of CHANNEL_TABLES changed, or `null` for a catch-up. */
  onChange: (table: string | null) => void
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
