import type { AgentColorKey } from "@dopl/contracts";
import type { TaskStatus } from "@/features/channels/types";

/** `GET /api/home/needs` — what is waiting on the reader across their home channels. */

/** Each list's ceiling. */
export const HOME_NEEDS_LIMIT = 20;

interface HomeNeedPlace {
  channelId: string;
  /** The channel's container: what /home opens. */
  workspaceId: string;
  channelName: string;
}

/**
 * Who asked. A person: their name and photo. An agent: its operator-given name (`null` when its
 * session row is gone), its owner's photo, colour and runtime as last reported.
 */
export type HomeNeedAuthor =
  | { kind: "person"; name: string; photo: string | null }
  | {
      kind: "agent";
      name: string | null;
      photo: string | null;
      color: AgentColorKey | null;
      runtime: string | null;
    };

/** An unanswered decision card the reader may answer. */
export interface HomeNeedDecision extends HomeNeedPlace {
  messageId: string;
  seq: number;
  threadId: string | null;
  question: string;
  author: HomeNeedAuthor;
  postedAt: string;
}

/** An unresolved task assigned to the reader themself (not to one of their agents). */
export interface HomeNeedTask extends HomeNeedPlace {
  taskId: string;
  title: string;
  status: Exclude<TaskStatus, "resolved">;
  dueAt: string | null;
  progress: { done: number; total: number } | null;
  updatedAt: string;
}

/** Newest first. `truncated` says a list stopped at its ceiling. */
export interface HomeNeeds {
  decisions: HomeNeedDecision[];
  tasks: HomeNeedTask[];
  truncated: { decisions: boolean; tasks: boolean };
}

export const EMPTY_HOME_NEED_DECISIONS: readonly HomeNeedDecision[] = Object.freeze([]);
export const EMPTY_HOME_NEED_TASKS: readonly HomeNeedTask[] = Object.freeze([]);
