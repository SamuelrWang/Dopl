import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelTaskReadRow } from "@/features/channels/server/dto-tasks";
import { listAssignedOpenTasks, listDecisionCandidates, type DecisionCandidateRow } from "./repository-needs";
import { answerableDecisions, toNeedDecision, toNeedTask } from "./service-needs";

const VIEWER = "u-viewer";
const OTHER = "u-other";
const PLACE = { workspaceId: "ws-1", name: "deploys" };
const ESCALATION = {
  issue: "Ship tonight?",
  context: "",
  options: [
    { label: "Yes", consequence: "" },
    { label: "No", consequence: "" },
  ],
  recommendation: null,
};

function card(over: Partial<DecisionCandidateRow> & { meta?: Record<string, unknown> } = {}): DecisionCandidateRow {
  const { meta, ...rest } = over;
  return {
    id: "m-1",
    seq: 10,
    channel_id: "ch-1",
    author_user_id: VIEWER,
    author_kind: "agent",
    client_msg_id: null,
    metadata: { escalation: ESCALATION, ...meta },
    created_at: "2026-10-26T10:00:00.000Z",
    ...rest,
  };
}

describe("answerableDecisions", () => {
  it("keeps the reader's own untagged card and a card tagging them, newest first, once each", () => {
    const own = card({ id: "own", seq: 5 });
    const tagged = card({ id: "tagged", seq: 9, author_user_id: OTHER, meta: { mentionedUserIds: [VIEWER] } });
    expect(answerableDecisions([own, tagged, tagged], VIEWER).map((row) => row.id)).toEqual(["tagged", "own"]);
  });

  it("drops a card the reader authored that tags somebody else", () => {
    expect(answerableDecisions([card({ meta: { mentionedUserIds: [OTHER] } })], VIEWER)).toEqual([]);
  });

  it("drops an answered, a superseded and an unparseable card", () => {
    const answered = card({
      id: "a",
      meta: { display: { spec_version: 2, display_id: "d", blocks: [], answer: { index: 0 } } },
    });
    const superseded = card({
      id: "s",
      meta: { display: { spec_version: 2, display_id: "d", blocks: [], superseded_by: "m-9" } },
    });
    const broken = card({ id: "b", metadata: { escalation: { issue: 3 } } });
    expect(answerableDecisions([answered, superseded, broken], VIEWER)).toEqual([]);
  });
});

describe("the payload rows", () => {
  it("names the question, the place and the thread", () => {
    const need = toNeedDecision(card({ meta: { threadId: "th-1" } }), PLACE, "Sam");
    expect(need).toMatchObject({
      question: "Ship tonight?",
      workspaceId: "ws-1",
      channelName: "deploys",
      threadId: "th-1",
      seq: 10,
      author: { kind: "agent", name: "Sam" },
    });
  });

  it("carries a task's status, due date and subtask progress", () => {
    const row = {
      id: "t-1",
      channel_id: "ch-1",
      workspace_id: "ws-1",
      title: "Runbook",
      description: "",
      status: "in_progress",
      created_by: VIEWER,
      created_by_agent: null,
      linked_thread_id: null,
      linked_message_id: null,
      due_at: "2026-10-30T00:00:00.000Z",
      resolved_at: null,
      resolved_by: null,
      resolved_by_agent: null,
      client_msg_id: null,
      created_at: "2026-10-20T00:00:00.000Z",
      updated_at: "2026-10-25T00:00:00.000Z",
      channel_task_assignees: [],
      channel_task_subtasks: [
        { id: "s1", task_id: "t-1", position: 0, title: "a", detail: null, owner_user_id: null, owner_agent_id: null, state: "done", created_by: null, client_msg_id: null, created_at: "x", updated_at: "x" },
        { id: "s2", task_id: "t-1", position: 1, title: "b", detail: null, owner_user_id: null, owner_agent_id: null, state: "todo", created_by: null, client_msg_id: null, created_at: "x", updated_at: "x" },
      ],
      linked_thread: null,
      linked_message: null,
    } as ChannelTaskReadRow;
    expect(toNeedTask(row, PLACE)).toMatchObject({
      taskId: "t-1",
      status: "in_progress",
      dueAt: "2026-10-30T00:00:00.000Z",
      progress: { done: 1, total: 2 },
    });
  });
});

type Call = { op: string; args: unknown[] };

function makeAdmin() {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const rec = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  for (const op of ["from", "select", "in", "eq", "is", "not", "contains", "order", "limit"]) builder[op] = rec(op);
  builder.then = (resolve: (r: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

beforeEach(() => vi.clearAllMocks());

describe("the reads' query shape", () => {
  it("asks for the reader's own unresolved assignments, not their agents'", async () => {
    const calls = makeAdmin();
    await listAssignedOpenTasks(["ch-1"], VIEWER, 21);
    expect(calls).toContainEqual({ op: "in", args: ["status", ["open", "in_progress"]] });
    expect(calls).toContainEqual({ op: "eq", args: ["mine.user_id", VIEWER] });
    expect(calls).toContainEqual({ op: "is", args: ["mine.agent_id", null] });
    expect(String(calls.find((c) => c.op === "select")?.args[0])).toContain("mine:channel_task_assignees!inner");
  });

  it("scans decision cards that tag the reader and those they wrote", async () => {
    const calls = makeAdmin();
    await listDecisionCandidates(["ch-1"], VIEWER, 40);
    expect(calls.filter((c) => c.op === "not")).toEqual([
      { op: "not", args: ["metadata->escalation", "is", null] },
      { op: "not", args: ["metadata->escalation", "is", null] },
    ]);
    expect(calls).toContainEqual({ op: "contains", args: ["metadata->mentionedUserIds", JSON.stringify([VIEWER])] });
    expect(calls).toContainEqual({ op: "eq", args: ["author_user_id", VIEWER] });
  });

  it("reads nothing with no channels", async () => {
    const calls = makeAdmin();
    await listAssignedOpenTasks([], VIEWER, 21);
    await listDecisionCandidates([], VIEWER, 40);
    expect(calls).toEqual([]);
  });
});
