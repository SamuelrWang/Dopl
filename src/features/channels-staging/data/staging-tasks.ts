/**
 * STAGING DATA — #tech-debt's seeded tasks in the product's own shape
 * (`@dopl/contracts › tasks.ts › ChannelTaskDetail`), drawn by the PRODUCT tasks UI
 * (`channels/components/tasks-panel.tsx`, `tasks-quick-view.tsx`) over the in-memory store
 * (`../store/use-staging-tasks.ts`). Links are read off the demo's own messages and threads (bodies
 * matched by prefix, the way `tech-debt-fixture.ts` finds its split post), so every link opens
 * something real. Other channels start empty, which is the empty state.
 */

import { AGENT_IDS, DEMO_CHANNEL, minsAgo } from "./demo-imports";
import { THREAD_IDS, U } from "@/features/marketing/components/banner-demo/demo-data";
import {
  agentActor as agent,
  channelTask,
  personActor as person,
  threadLink,
} from "@/features/marketing/components/banner-demo/demo-tasks";
import type {
  ChannelTaskDetail,
  TaskActor,
  TaskLink,
  TaskStatus,
} from "@/features/channels/types";
import type { ChannelFixture } from "./staging-fixture-types";
import { taskDetails } from "./staging-task-details";

function messageLink(f: ChannelFixture, bodyPrefix: string): TaskLink | null {
  const m = f.messages.find((x) => x.body.startsWith(bodyPrefix));
  return m ? { kind: "message", messageId: m.id, seq: m.seq } : null;
}

function task(
  id: string,
  title: string,
  createdBy: TaskActor,
  assignees: TaskActor[],
  status: TaskStatus,
  link: TaskLink | null,
  minutesAgo: number,
  resolved?: { by: TaskActor; minutesAgo: number }
): ChannelTaskDetail {
  return channelTask({
    id,
    title,
    ...taskDetails(id),
    createdBy,
    assignees,
    status,
    link,
    createdAt: minsAgo(minutesAgo),
    resolved: resolved && { by: resolved.by, at: minsAgo(resolved.minutesAgo) },
  });
}

/** The channel's seeded tasks; `[]` for every channel but the demo's. */
export function seedTasks(f: ChannelFixture): ChannelTaskDetail[] {
  if (f.channel.id !== DEMO_CHANNEL.id) return [];
  return [
    task(
      "task-teardown",
      "Fix session teardown leaks",
      agent(AGENT_IDS.planner),
      [agent(AGENT_IDS.teardown), agent(AGENT_IDS.notice), agent(AGENT_IDS.wake)],
      "in_progress",
      threadLink(THREAD_IDS.teardown),
      3
    ),
    task(
      "task-flakes",
      "Stabilise the four flakiest tests",
      agent(AGENT_IDS.triage),
      [agent(AGENT_IDS.triage)],
      "in_progress",
      threadLink(THREAD_IDS.flakes),
      3
    ),
    task(
      "task-uploads",
      "Fix upload retries timing out",
      agent(AGENT_IDS.scout),
      [agent(AGENT_IDS.scout), person(U.anthony)],
      "open",
      threadLink(THREAD_IDS.uploads),
      2
    ),
    task(
      "task-flake-doc",
      "Write up the flaky suite in the knowledge base",
      agent(AGENT_IDS.scout),
      [person(U.grace)],
      "open",
      messageLink(f, "Checked the knowledge base."),
      5
    ),
    task(
      "task-eng-help",
      "Rank the complaints in #eng-help",
      person(U.grace),
      [agent(AGENT_IDS.triage)],
      "resolved",
      messageLink(f, "Read the last two weeks"),
      6,
      { by: agent(AGENT_IDS.triage), minutesAgo: 5 }
    ),
    task(
      "task-split",
      "Split the cleanup between the orchestrators",
      person(U.samuel),
      [agent(AGENT_IDS.planner), agent(AGENT_IDS.triage), agent(AGENT_IDS.scout)],
      "resolved",
      messageLink(f, "@debt-triage you have the most context"),
      6,
      { by: person(U.samuel), minutesAgo: 3 }
    ),
  ];
}
