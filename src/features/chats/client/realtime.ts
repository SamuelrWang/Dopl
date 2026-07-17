"use client";

import { useWorkspaceTablesRealtime } from "@/shared/realtime/use-workspace-tables-realtime";

const CHAT_TABLES = ["chats", "chat_messages", "chat_folders"] as const;

/** Realtime refetch signal for the chats tables of a workspace. */
export function useChatsRealtime(
  workspaceId: string | null | undefined,
  onChange: () => void
): void {
  useWorkspaceTablesRealtime(
    workspaceId,
    CHAT_TABLES,
    "chats-realtime",
    onChange
  );
}
