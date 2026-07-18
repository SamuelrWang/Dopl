import type { Database, Json } from "@/shared/supabase/types";
import type {
  Chat,
  ChatAccessMode,
  ChatFolder,
  ChatMessage,
  ChatOwner,
  ChatSource,
  ChatVisibility,
  Deliverable,
  ExportFormat,
  MessageRole,
  TrashedChat,
} from "../types";

export type ChatRow = Database["public"]["Tables"]["chats"]["Row"];
export type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];
export type ChatFolderRow = Database["public"]["Tables"]["chat_folders"]["Row"];

export type ProfileRef = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export function mapOwner(userId: string, profile: ProfileRef | undefined): ChatOwner {
  return {
    userId,
    name: profile?.display_name || profile?.email || "Unknown member",
    avatarUrl: profile?.avatar_url ?? null,
  };
}

/** jsonb → Deliverable[], dropping anything malformed instead of throwing. */
function mapDeliverables(value: Json): Deliverable[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof item.label === "string" &&
      typeof item.done === "boolean"
    ) {
      return [{ label: item.label, done: item.done }];
    }
    return [];
  });
}

function mapLearnings(value: Json): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function mapChatRow(
  row: ChatRow,
  owner: ChatOwner,
  messageCount: number,
  grantedTeamIds: string[] = []
): Chat {
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    overview: row.overview,
    pinned: row.pinned,
    visibility: row.visibility as ChatVisibility,
    accessMode: row.access_mode as ChatAccessMode,
    grantedTeamIds,
    owner,
    source: row.source as ChatSource,
    project: row.project,
    format: row.format as ExportFormat,
    sessionDate: row.session_date,
    exportedAt: row.exported_at,
    updatedAt: row.updated_at,
    messageCount,
    deliverables: mapDeliverables(row.deliverables),
    learnings: mapLearnings(row.learnings),
  };
}

/**
 * Trashed-chat DTO for the trash listing. `deleted_at` is added by
 * migration 20260718000002 and not yet in the generated `ChatRow` type
 * (regenerated after the migration applies), so it is read through a cast.
 */
export function mapTrashedChatRow(
  row: ChatRow,
  owner: ChatOwner,
  messageCount: number
): TrashedChat {
  const deletedAt = (row as { deleted_at?: string | null }).deleted_at ?? "";
  return { ...mapChatRow(row, owner, messageCount), deletedAt };
}

export function mapMessageRow(row: ChatMessageRow): ChatMessage {
  return {
    index: row.position,
    role: row.role as MessageRole,
    summary: row.summary,
    verbatim: row.verbatim,
  };
}

export function mapFolderRow(
  row: ChatFolderRow,
  grantedTeamIds: string[] = []
): ChatFolder {
  return {
    id: row.id,
    name: row.name,
    visibility: row.visibility as ChatVisibility,
    accessMode: row.access_mode as ChatAccessMode,
    grantedTeamIds,
  };
}
