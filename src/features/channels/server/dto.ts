import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelMessageKind,
  ChannelRole,
  ChannelVisibility,
  MessageAuthorKind,
} from "../types";

/**
 * DB row shapes for the channels tables. Hand-written (rather than pulled
 * from the generated `Database` type) because the generated
 * `src/shared/supabase/types.ts` is not regenerated for this migration —
 * the same cast pattern the chats feature uses for its newer columns. The
 * repository casts Supabase results to these shapes at the boundary.
 */
export type ChannelRow = {
  id: string;
  workspace_id: string;
  created_by: string;
  slug: string;
  name: string;
  topic: string;
  visibility: string;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChannelMemberRow = {
  channel_id: string;
  user_id: string;
  workspace_id: string;
  role: string;
  last_read_at: string | null;
  added_by: string | null;
  joined_at: string;
};

export type ChannelMessageRow = {
  id: string;
  seq: number;
  channel_id: string;
  workspace_id: string;
  author_user_id: string | null;
  author_kind: string;
  kind: string;
  body: string;
  metadata: unknown;
  client_msg_id: string | null;
  created_at: string;
};

export type ProfileRef = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

/** Per-caller state layered onto a channel row to form the list DTO. */
export interface ChannelViewerState {
  memberCount: number;
  lastMessageAt: string | null;
  role: ChannelRole | null;
  lastReadAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mapChannelRow(
  row: ChannelRow,
  state: ChannelViewerState
): Channel {
  const isMember = state.role !== null;
  // Compare instants, not raw ISO strings: `lastMessageAt` (from Postgres,
  // `+00:00` offset, microseconds) and `lastReadAt` (a JS `toISOString()`,
  // `Z`, milliseconds) are differently formatted, so a lexicographic `>`
  // gives wrong answers. Date.parse normalizes both to epoch ms.
  const unread =
    isMember &&
    state.lastMessageAt !== null &&
    (state.lastReadAt === null ||
      Date.parse(state.lastMessageAt) > Date.parse(state.lastReadAt));
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    topic: row.topic,
    visibility: row.visibility as ChannelVisibility,
    createdBy: row.created_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: state.memberCount,
    lastMessageAt: state.lastMessageAt,
    role: state.role,
    isMember,
    lastReadAt: state.lastReadAt,
    unread,
  };
}

export function mapMessageRow(
  row: ChannelMessageRow,
  profile: ProfileRef | undefined
): ChannelMessage {
  return {
    id: row.id,
    seq: Number(row.seq),
    channelId: row.channel_id,
    authorUserId: row.author_user_id,
    authorKind: row.author_kind as MessageAuthorKind,
    kind: row.kind as ChannelMessageKind,
    body: row.body,
    metadata: isRecord(row.metadata) ? row.metadata : {},
    clientMsgId: row.client_msg_id,
    createdAt: row.created_at,
    authorName: profile?.display_name || profile?.email || null,
    authorAvatarUrl: profile?.avatar_url ?? null,
  };
}

export function mapMemberRow(
  row: ChannelMemberRow,
  profile: ProfileRef | undefined
): ChannelMember {
  return {
    channelId: row.channel_id,
    userId: row.user_id,
    role: row.role as ChannelRole,
    lastReadAt: row.last_read_at,
    addedBy: row.added_by,
    joinedAt: row.joined_at,
    displayName: profile?.display_name ?? null,
    email: profile?.email ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  };
}
