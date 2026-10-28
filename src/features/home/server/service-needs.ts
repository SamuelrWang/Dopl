import "server-only";
import { answerersOf } from "@/features/display/core/answerers";
import { DISPLAY_METADATA_KEY } from "@/features/display/core/types";
import { ESCALATION_METADATA_KEY, parseStoredEscalation } from "@/features/channels/escalation";
import { mapTaskRow, type ChannelTaskReadRow } from "@/features/channels/server/dto-tasks";
import { listAccountChannelRefs } from "@/features/channels/server/repository-account";
import { listAnsweredEscalationIds } from "@/features/channels/server/repository-messages";
import { threadIdOf } from "@/features/channels/server/service-mentions";
import { listProfileSummaries, type ProfileSummary } from "@/features/workspaces/server/repository";
import { authorAgentIdOf } from "@/features/channels/lib/agent-post-stamp";
import { agentColorOrNull } from "@/shared/lib/agent-colors";
import {
  HOME_NEEDS_LIMIT,
  type HomeNeedAuthor,
  type HomeNeedDecision,
  type HomeNeeds,
  type HomeNeedTask,
} from "../needs-types";
import * as repo from "./repository";
import {
  listAgentFaceRows,
  listAssignedOpenTasks,
  listDecisionCandidates,
  type AgentFaceRow,
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

/** A display already answered (`display.answer`) or withdrawn (`display.superseded_by`). */
function isClosedDisplay(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const envelope = raw as { answer?: unknown; superseded_by?: unknown };
  return Boolean(envelope.answer) || typeof envelope.superseded_by === "string";
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
    if (isClosedDisplay(row.metadata?.[DISPLAY_METADATA_KEY])) continue;
    if (!parseStoredEscalation(row.metadata?.[ESCALATION_METADATA_KEY])) continue;
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => Number(b.seq) - Number(a.seq));
}

/** The face facts for a card's author: the agent that wrote it (by the one parser), else the person. */
export function authorOf(
  row: DecisionCandidateRow,
  owner: ProfileSummary | undefined,
  agents: ReadonlyMap<string, AgentFaceRow>
): HomeNeedAuthor {
  const photo = owner?.avatarUrl ?? null;
  if (row.author_kind !== "agent") {
    return { kind: "person", name: owner?.displayName || owner?.email || "", photo };
  }
  const agentId = authorAgentIdOf({ clientMsgId: row.client_msg_id, metadata: row.metadata });
  const session = agentId ? agents.get(agentId) : undefined;
  return {
    kind: "agent",
    name: session?.display_name?.trim() || null,
    photo,
    color: agentColorOrNull(session?.color),
    runtime: session?.runtime || null,
  };
}

/** Newest session row per agent id (the read is newest first). */
function agentFacesById(rows: readonly AgentFaceRow[]): Map<string, AgentFaceRow> {
  const out = new Map<string, AgentFaceRow>();
  for (const row of rows) if (!out.has(row.name)) out.set(row.name, row);
  return out;
}

export function toNeedDecision(
  row: DecisionCandidateRow,
  place: HomeChannelPlace,
  author: HomeNeedAuthor
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
    author,
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
  const placeOf = (row: DecisionCandidateRow) => places.get(row.channel_id) as HomeChannelPlace;
  const agentIds = kept.flatMap((row) => {
    if (row.author_kind !== "agent") return [];
    const id = authorAgentIdOf({ clientMsgId: row.client_msg_id, metadata: row.metadata });
    return id ? [id] : [];
  });
  const [profiles, faceRows] = await Promise.all([
    listProfileSummaries([
      ...new Set(kept.flatMap((row) => (row.author_user_id ? [row.author_user_id] : []))),
    ]),
    listAgentFaceRows([...new Set(kept.map((row) => placeOf(row).workspaceId))], [...new Set(agentIds)]),
  ]);
  const agents = agentFacesById(faceRows);
  return {
    items: kept.map((row) =>
      toNeedDecision(
        row,
        placeOf(row),
        authorOf(row, row.author_user_id ? profiles.get(row.author_user_id) : undefined, agents)
      )
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
