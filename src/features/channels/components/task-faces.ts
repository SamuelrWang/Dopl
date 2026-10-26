"use client";

import { agentFaceName } from "@/shared/lib/agent-name";
import type { IdentityStackFace } from "@/shared/ui/avatar-stack";
import type { IdentityFacts } from "@/shared/ui/identity-face";
import { useRuntimeLogo } from "@/shared/ui/runtime-logo";
import type { StatusTone } from "@/shared/ui/status-pill";
import { memberLabel } from "../lib/channel-display";
import { actorKey } from "../lib/task-model";
import { agentIdentity, agentRuntime, type AgentFeeds } from "./agent-face";
import type { AuthorIndex } from "./view-model";
import type { ChannelTask, SubtaskState, TaskActor, TaskStatus } from "../types";

/** `IdentityFace` props for one actor, plus the name the row prints. */
type TaskFace = IdentityFacts & { name: string };

export type TaskFaceOf = (actor: TaskActor) => TaskFace;

/** An agent is its owner's photo in its colour ring with its runtime badge, a person a plain
 *  photo. Names come off the roster and the agent index, never an id. */
export function taskFaceResolver(
  index: AuthorIndex,
  feeds: AgentFeeds,
  logoFor: (runtime: string | null | undefined) => string | null
): TaskFaceOf {
  return (actor) => {
    const owner = index.byId.get(actor.userId);
    const photo = owner?.avatarUrl ?? null;
    if (actor.kind === "person") {
      return { name: owner ? memberLabel(owner) : "Member", photo };
    }
    const entry = index.agents.get(actor.agentId);
    const name = agentFaceName(entry?.displayName);
    return {
      ...agentIdentity(
        { photo, name, color: entry?.color, runtime: agentRuntime(feeds, actor.agentId) },
        logoFor
      ),
      name,
    };
  };
}

/** One actor's face for an `IdentityStack`, keyed by the actor. */
export function taskStackFace(actor: TaskActor, faceOf: TaskFaceOf): IdentityStackFace {
  return { key: actorKey(actor), ...faceOf(actor) };
}

export function useTaskFaces(index: AuthorIndex, feeds: AgentFeeds): TaskFaceOf {
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
export function workingTaskFaces(
  tasks: readonly ChannelTask[],
  faceOf: TaskFaceOf
): IdentityStackFace[] {
  const seen = new Set<string>();
  const out: IdentityStackFace[] = [];
  for (const t of tasks) {
    if (t.status !== "in_progress") continue;
    for (const a of t.assignees) {
      const key = actorKey(a);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(taskStackFace(a, faceOf));
    }
  }
  return out.slice(0, 3);
}
