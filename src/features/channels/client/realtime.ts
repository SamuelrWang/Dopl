"use client";

import { useWorkspaceTablesRealtime } from "@/shared/realtime/use-workspace-tables-realtime";
import { CHANNEL_TABLES } from "../constants";

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
