export type ConversationSource =
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "other";

export type ExportFormat = "summarized" | "verbatim" | "mixed";

export type MessageRole = "user" | "agent";

export type ConversationMessage = {
  index: number;
  role: MessageRole;
  /** Concise agent-written summary — the default export form. */
  summary: string;
  /** Exact original text; present only when the user asked for verbatim. */
  verbatim?: string;
};

export type Deliverable = {
  label: string;
  done: boolean;
};

export type ConversationFolder = {
  id: string;
  name: string;
};

export type Conversation = {
  id: string;
  folderId: string | null;
  title: string;
  pinned: boolean;
  source: ConversationSource;
  project: string | null;
  format: ExportFormat;
  /** ISO date the session happened. */
  sessionDate: string;
  /** ISO datetime the agent exported it into Dopl. */
  exportedAt: string;
  /** One-paragraph agent-written framing of what the session was about. */
  overview: string;
  deliverables: Deliverable[];
  learnings: string[];
  messages: ConversationMessage[];
};
