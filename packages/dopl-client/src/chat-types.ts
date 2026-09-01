/**
 * Chat archive types — agent-exported conversations.
 * Mirrors src/features/chats/types.ts in the app.
 */

export type ChatSource =
  | "claude-code"
  | "claude-desktop"
  | "codex"
  | "cursor"
  | "other";

export type ChatExportFormat = "summarized" | "verbatim" | "mixed";

export type ChatVisibility = "private" | "public";

export type ChatMessageRole = "user" | "agent";

export interface ChatOwner {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface ChatMessage {
  index: number;
  role: ChatMessageRole;
  summary: string;
  verbatim: string | null;
}

export interface ChatDeliverable {
  label: string;
  done: boolean;
}

export type ChatFolderAccessMode = "workspace" | "teams";

/**
 * ⚠ Folder sharing scope is authoritative for the chats filed in it: chats
 * inherit folder visibility on move, and a folder scope change propagates to
 * every chat inside. Filed chats can't be shared individually.
 */
export interface ChatFolder {
  id: string;
  name: string;
  visibility: ChatVisibility;
  accessMode: ChatFolderAccessMode;
  /** Populated only when accessMode is 'teams'. */
  grantedTeamIds: string[];
}

export interface ChatFolderUpdateInput {
  name?: string;
  visibility?: ChatVisibility;
  accessMode?: ChatFolderAccessMode;
  /** Only with visibility 'public' + accessMode 'teams'. */
  teamIds?: string[];
}

export interface Chat {
  id: string;
  folderId: string | null;
  title: string;
  overview: string;
  pinned: boolean;
  visibility: ChatVisibility;
  owner: ChatOwner;
  source: ChatSource;
  project: string | null;
  format: ChatExportFormat;
  sessionDate: string;
  exportedAt: string;
  updatedAt: string;
  messageCount: number;
  deliverables: ChatDeliverable[];
  learnings: string[];
}

export type ChatDetail = Chat & { messages: ChatMessage[] };

/**
 * Visible chats + how many the workspace's free-plan retention window excluded
 * (0 on Pro / full-history plans).
 */
export interface ChatList {
  chats: Chat[];
  hiddenCount: number;
}

export interface ChatMessageInput {
  role: ChatMessageRole;
  summary: string;
  verbatim?: string | null;
}

export interface ChatExportInput {
  title: string;
  overview?: string;
  source?: ChatSource;
  project?: string | null;
  sessionDate?: string;
  clientSessionId?: string;
  folder?: string;
  visibility?: ChatVisibility;
  deliverables?: ChatDeliverable[];
  learnings?: string[];
  /** `format` is derived server-side from the messages' verbatim mix. */
  messages: ChatMessageInput[];
}

export interface ChatUpdateInput {
  title?: string;
  overview?: string;
  project?: string | null;
  sessionDate?: string;
  folderId?: string | null;
  folder?: string | null;
  visibility?: ChatVisibility;
  pinned?: boolean;
  deliverables?: ChatDeliverable[];
  learnings?: string[];
}
