import type { KnowledgeBase, KnowledgeEntry, KnowledgeFolder } from "../../types";

/** Minimal team ref for the admin card pills (carried over from v1). */
export interface KbTeamRef {
  teamId: string;
  name: string;
  color: string | null;
}

/** Scope filter shown as the tab row in the list pane. */
export type ListFilter = "all" | "private" | "team" | "workspace";

/** A base's lazily-loaded tree, plus its fetch status. */
export interface BaseTree {
  status: "loading" | "ready" | "error";
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}

/** What the detail pane is currently showing. */
export type Selection =
  | { kind: "base"; base: KnowledgeBase }
  | { kind: "entry"; base: KnowledgeBase; entry: KnowledgeEntry };
