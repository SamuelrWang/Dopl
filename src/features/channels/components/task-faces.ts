"use client";

import { agentFaceName } from "@/shared/lib/agent-name";
import type { IdentityRing } from "@/shared/ui/identity-face";
import { useRuntimeLogo } from "@/shared/ui/runtime-logo";
import type { StatusTone } from "@/shared/ui/status-pill";
import { actorKey } from "../lib/task-model";
import { ownAgentRuntime } from "./agent-face";
import type { ThreadCardAgentFeeds } from "./thread-card-agents";
import type { AuthorIndex } from "./view-model";
import type { ChannelTask, SubtaskState, TaskActor, TaskStatus } from "../types";

/** `IdentityFace` props for one actor: an agent is its owner's photo in its colour ring with its
 *  runtime badge, a person a plain photo. */
export interface TaskFace {
  key: string;
  name: string;
  photo: string | null;
  ring?: IdentityRing;
  runtimeLogo?: string | null;
}

export type TaskFaceOf = (actor: TaskActor) => TaskFace;

function agentRuntime(agentId: string, feeds: ThreadCardAgentFeeds): string | null {
  const own = feeds.sessions?.find((s) => s.agentId === agentId);
  if (own) return ownAgentRuntime(own, feeds.peers);
  return feeds.peers.find((p) => p.name === agentId)?.runtime ?? null;
}

/** Names come off the roster and the agent index, never an id. */
export function taskFaceResolver(
  index: AuthorIndex,
  feeds: ThreadCardAgentFeeds,
  logoFor: (runtime: string | null | undefined) => string | null
): TaskFaceOf {
  return (actor) => {
    const owner = index.byId.get(actor.userId);
    const photo = owner?.avatarUrl ?? null;
    if (actor.kind === "person") {
      return { key: actorKey(actor), name: owner?.displayName ?? owner?.email ?? "Member", photo };
    }
    const entry = index.agents.get(actor.agentId);
    return {
      key: actorKey(actor),
      name: agentFaceName(entry?.displayName),
      photo,
      ring: entry?.color ?? "neutral",
      runtimeLogo: logoFor(agentRuntime(actor.agentId, feeds)),
    };
  };
}

export function useTaskFaces(index: AuthorIndex, feeds: ThreadCardAgentFeeds): TaskFaceOf {
  return taskFaceResolver(index, feeds, useRuntimeLogo());
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

export const SUBTASK_STATE_LABEL: Record<SubtaskState, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

/** Task statuses and subtask states share the status pill's tones. */
export const STATUS_TONE: Record<TaskStatus | SubtaskState, StatusTone> = {
  open: "neutral",
  todo: "neutral",
  in_progress: "attention",
  resolved: "done",
  done: "done",
};

/** Faces of whoever is on in-progress work, once each, at most three: the quick view's pill. */
export function workingTaskFaces(tasks: readonly ChannelTask[], faceOf: TaskFaceOf): TaskFace[] {
  const seen = new Set<string>();
  const out: TaskFace[] = [];
  for (const t of tasks) {
    if (t.status !== "in_progress") continue;
    for (const a of t.assignees) {
      const key = actorKey(a);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(faceOf(a));
    }
  }
  return out.slice(0, 3);
}
