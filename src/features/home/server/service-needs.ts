import "server-only";
import { answerersOf } from "@/features/display/core/answerers";
import { displayOf } from "@/features/display/core/adapt";
import { ESCALATION_METADATA_KEY, parseStoredEscalation } from "@/features/channels/escalation";
import { mapTaskRow, type ChannelTaskReadRow } from "@/features/channels/server/dto-tasks";
import { listAccountChannelRefs } from "@/features/channels/server/repository-account";
import { listAnsweredEscalationIds } from "@/features/channels/server/repository-messages";
import { threadIdOf } from "@/features/channels/server/service-mentions";
import { listProfileSummaries } from "@/features/workspaces/server/repository";
import {
  HOME_NEEDS_LIMIT,
  type HomeNeedDecision,
  type HomeNeeds,
  type HomeNeedTask,
} from "../needs-types";
import * as repo from "./repository";
import {
  listAssignedOpenTasks,
  listDecisionCandidates,
  type DecisionCandidateRow,
} from "./repository-needs";

const NEEDS_CONTAINER_LIMIT = 200;
/** Each candidate scan reads past the ceiling, since answered and other people's cards drop out. */
const DECISION_SCAN_LIMIT = HOME_NEEDS_LIMIT * 2;

type HomeChannelPlace = { workspaceId: string; name: string };

/**
 * The fence: live channels the reader is a member of (`listAccountChannelRefs`, the account-wide
 * proof of access), narrowed to their home channels' containers.
 */
async function visibleHomeChannels(userId: string): Promise<Map<string, HomeChannelPlace>> {
  const [containers, refs] = await Promise.all([
    repo.listLinkContainers(userId, NEEDS_CONTAINER_LIMIT),
    listAccountChannelRefs(userId),
  ]);
  const home = new Set(containers.map((container) => container.id));
  return new Map(
    refs.rows
      .filter((ref) => home.has(ref.workspaceId))
      .map((ref) => [ref.id, { workspaceId: ref.workspaceId, name: ref.name }])
  );
}

/** Cards the reader may answer that are still open, newest first; deduplicated across both scans. */
export function answerableDecisions(
  rows: readonly DecisionCandidateRow[],
  userId: string
): DecisionCandidateRow[] {
  const byId = new Map<string, DecisionCandidateRow>();
  for (const row of rows) {
    if (byId.has(row.id)) continue;
    if (!answerersOf(row.metadata, row.author_user_id).includes(userId)) continue;
    const display = displayOf(row.metadata, { messageId: row.id });
    if (display?.answer || display?.superseded_by) continue;
    if (!parseStoredEscalation(row.metadata?.[ESCALATION_METADATA_KEY])) continue;
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => Number(b.seq) - Number(a.seq));
}

export function toNeedDecision(
  row: DecisionCandidateRow,
  place: HomeChannelPlace,
  authorName: string
): HomeNeedDecision {
  const escalation = parseStoredEscalation(row.metadata?.[ESCALATION_METADATA_KEY]);
  return {
    channelId: row.channel_id,
    workspaceId: place.workspaceId,
    channelName: place.name,
    messageId: row.id,
    seq: Number(row.seq),
    threadId: threadIdOf(row.metadata),
    question: escalation?.issue ?? "",
    author: { kind: row.author_kind === "agent" ? "agent" : "person", name: authorName },
    postedAt: row.created_at,
  };
}

export function toNeedTask(row: ChannelTaskReadRow, place: HomeChannelPlace): HomeNeedTask {
  const task = mapTaskRow(row);
  return {
    channelId: task.channelId,
    workspaceId: place.workspaceId,
    channelName: place.name,
    taskId: task.id,
    title: task.title,
    status: task.status === "in_progress" ? "in_progress" : "open",
    dueAt: task.dueAt,
    progress: task.progress,
    updatedAt: task.updatedAt,
  };
}

async function needDecisions(
  userId: string,
  places: Map<string, HomeChannelPlace>
): Promise<{ items: HomeNeedDecision[]; truncated: boolean }> {
  const { tagged, authored } = await listDecisionCandidates([...places.keys()], userId, DECISION_SCAN_LIMIT);
  const candidates = answerableDecisions([...tagged, ...authored], userId);
  const answered = await listAnsweredEscalationIds(
    [...new Set(candidates.map((row) => row.channel_id))],
    candidates.map((row) => row.id)
  );
  const open = candidates.filter((row) => !answered.has(row.id));
  const kept = open.slice(0, HOME_NEEDS_LIMIT);
  const profiles = await listProfileSummaries([
    ...new Set(kept.flatMap((row) => (row.author_user_id ? [row.author_user_id] : []))),
  ]);
  const nameOf = (id: string | null) => {
    const profile = id ? profiles.get(id) : undefined;
    return profile?.displayName || profile?.email || "";
  };
  return {
    items: kept.map((row) =>
      toNeedDecision(row, places.get(row.channel_id) as HomeChannelPlace, nameOf(row.author_user_id))
    ),
    truncated:
      open.length > HOME_NEEDS_LIMIT ||
      tagged.length >= DECISION_SCAN_LIMIT ||
      authored.length >= DECISION_SCAN_LIMIT,
  };
}

async function needTasks(
  userId: string,
  places: Map<string, HomeChannelPlace>
): Promise<{ items: HomeNeedTask[]; truncated: boolean }> {
  const rows = await listAssignedOpenTasks([...places.keys()], userId, HOME_NEEDS_LIMIT + 1);
  return {
    items: rows
      .slice(0, HOME_NEEDS_LIMIT)
      .map((row) => toNeedTask(row, places.get(row.channel_id) as HomeChannelPlace)),
    truncated: rows.length > HOME_NEEDS_LIMIT,
  };
}

/** Everything waiting on the reader across their home channels: decision cards, then tasks. */
export async function getHomeNeeds(userId: string): Promise<HomeNeeds> {
  const places = await visibleHomeChannels(userId);
  const [decisions, tasks] = await Promise.all([
    needDecisions(userId, places),
    needTasks(userId, places),
  ]);
  return {
    decisions: decisions.items,
    tasks: tasks.items,
    truncated: { decisions: decisions.truncated, tasks: tasks.truncated },
  };
}
