// STAGING ONLY — Overview Version D. What the page derives from the mock, plus the ONE piece of
// invented data it needs (`NEEDS`), kept here so it is listed in one place.
import type { MockHost, MockStatus } from "@/features/overview-staging/overview-mock-data";

/** An agent that is running right now, with the computer it runs on. */
export interface LiveAgent {
  id: string;
  name: string;
  channel: string;
  host: string;
  runtime: string;
  runningFor: number;
  state: "working" | "waiting";
}

export function liveAgents(hosts: readonly MockHost[]): LiveAgent[] {
  return hosts.flatMap((h) =>
    h.agents.map((a) => ({
      id: a.id,
      name: a.name,
      channel: a.channel,
      host: h.name,
      runtime: a.runtime,
      runningFor: a.runningFor,
      state: a.state,
    }))
  );
}

/** Every device, computers first, each with the computer it is reached through. */
export interface DeviceLine {
  id: string;
  kind: string;
  name: string;
  /** The computer an endpoint is reached through; null for a computer itself. */
  via: string | null;
  status: MockStatus;
  inUse: boolean;
}

export function deviceLines(hosts: readonly MockHost[]): DeviceLine[] {
  const computers = hosts.map((h) => ({
    id: h.id,
    kind: "computer",
    name: h.name,
    via: null,
    status: h.status,
    inUse: false,
  }));
  const endpoints = hosts.flatMap((h) =>
    h.endpoints.map((e) => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      via: h.name,
      status: e.status,
      inUse: Boolean(e.inUse),
    }))
  );
  // What answers you right now leads; then computers; then the rest.
  return [...endpoints.filter((e) => e.inUse), ...computers, ...endpoints.filter((e) => !e.inUse)];
}

/**
 * WHAT IS WAITING ON YOU. ⚠ INVENTED FOR VERSION D: the mock has no pending-approval or
 * open-question field. Both items are lifted from events the mock already tells
 * (`DEVICES_MOCK.logs › l8` "Permission asked", `DEVICES_MOCK.routes › r5` the outreach question)
 * and held open, so the hero has something real-shaped to lead with. The product reads these off
 * the approvals queue and open decisions.
 */
export interface Need {
  id: string;
  agentId: string;
  kind: "permission" | "question";
  at: string;
  ask: string;
}

export const NEEDS: readonly Need[] = [
  { id: "n1", agentId: "a3", kind: "permission", at: "13:20", ask: "Wants to post in Dopl" },
  {
    id: "n2",
    agentId: "a1",
    kind: "question",
    at: "11:02",
    ask: "Which account should the outreach go from?",
  },
];

/** "3h 4m" from minutes. */
export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
