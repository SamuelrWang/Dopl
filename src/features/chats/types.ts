export type ChatSource =
  | "claude-code"
  | "claude-desktop"
  | "codex"
  | "cursor"
  | "other";

export type ExportFormat = "summarized" | "verbatim" | "mixed";

/** Private = owner-only. Public = shared; access_mode says with whom. */
export type ChatVisibility = "private" | "public";

/** Public reach: the whole workspace, or only specifically granted teams. */
export type ChatAccessMode = "workspace" | "teams";

export type MessageRole = "user" | "agent";

export type ChatOwner = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

export type ChatMessage = {
  /** 1-based position in the transcript. */
  index: number;
  role: MessageRole;
  /** Agent-written summary — the default export form. */
  summary: string;
  /** Exact original text; present only when the user asked for verbatim. */
  verbatim: string | null;
};

export type Deliverable = {
  label: string;
  done: boolean;
};

/** ⚠ Personal folder whose scope is AUTHORITATIVE for its chats: they inherit
 *  visibility/access on move and on every folder scope change, and can't be
 *  shared individually — unfile first, or change the folder. */
export type ChatFolder = {
  id: string;
  name: string;
  visibility: ChatVisibility;
  accessMode: ChatAccessMode;
  /** Teams granted read access — populated only when accessMode is 'teams'. */
  grantedTeamIds: string[];
};

/** List-level chat: everything but the transcript. */
export type Chat = {
  id: string;
  folderId: string | null;
  title: string;
  /** Agent-written framing of what the session was about. */
  overview: string;
  pinned: boolean;
  visibility: ChatVisibility;
  accessMode: ChatAccessMode;
  /** Teams granted read access — populated only when accessMode is 'teams'. */
  grantedTeamIds: string[];
  owner: ChatOwner;
  source: ChatSource;
  project: string | null;
  format: ExportFormat;
  /** ISO date the session happened. */
  sessionDate: string;
  /** ISO datetime the agent exported it into Dopl. */
  exportedAt: string;
  updatedAt: string;
  messageCount: number;
  deliverables: Deliverable[];
  learnings: string[];
};

export type ChatDetail = Chat & { messages: ChatMessage[] };


/** Visible chats + how many the retention window excluded (0 on full-history
 *  plans). `hiddenCount` drives the "N older chats hidden" affordance. */
export type ChatList = {
  chats: Chat[];
  hiddenCount: number;
  /**
   * The read hit its ceiling (`constants.ts › CHAT_LIST_LIMIT`) — there are
   * older chats this payload does not contain.
   *
   * ⚠ DISTINCT FROM `hiddenCount`, and never merged with it. One is a PLAN
   * boundary with an upgrade behind it; this is a READ boundary with no remedy
   * to offer at all (INVARIANTS §9 — a notice may not promise a deeper read
   * that does not exist). ⚠ §8 STALE CACHE: added 2026-09-01, so a payload
   * cached by the previous bundle has no such key — every reader spells
   * `?? false`, which reads as "not clipped", the fail-safe direction.
   */
  truncated: boolean;
};
