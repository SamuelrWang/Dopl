export type ChatSource =
  | "claude-code"
  | "claude-desktop"
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
  /** Concise agent-written summary — the default export form. */
  summary: string;
  /** Exact original text; present only when the user asked for verbatim. */
  verbatim: string | null;
};

export type Deliverable = {
  label: string;
  done: boolean;
};

export type ChatFolder = {
  id: string;
  name: string;
};

/** List-level chat: everything but the transcript. */
export type Chat = {
  id: string;
  folderId: string | null;
  title: string;
  /** One-paragraph agent-written framing of what the session was about. */
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
