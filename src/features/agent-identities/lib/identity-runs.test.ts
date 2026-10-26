import { describe, expect, it } from "vitest";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { identity } from "../components/identity-editor-harness";
import {
  DEFAULT_ARRANGEMENT,
  arrangeIdentities,
  endedRuns,
  lastUsedAt,
  liveRuns,
  runningCount,
  runtimeReadiness,
} from "./identity-runs";

function session(over: Partial<DesktopSessionSummary> & { sessionId: string }): DesktopSessionSummary {
  return {
    channelId: "ch-1",
    threadId: "",
    name: "a1234567",
    state: "idle",
    channelName: "releases",
    threadTitle: null,
    ...over,
  } as DesktopSessionSummary;
}

const CAPTAIN = identity({ id: "id-1", name: "Release captain", runtime: "claude" });
const WRITER = identity({ id: "id-2", name: "Writer", runtime: "codex", description: "Drafts notes" });
const SESSIONS = [
  session({ sessionId: "s1", identityName: "Release captain", state: "working", startedAt: 100 }),
  session({ sessionId: "s2", identityName: "Release captain", state: "idle", startedAt: 300 }),
  session({ sessionId: "s3", identityName: "Release captain", state: "ended", endedAt: 900 }),
  session({ sessionId: "s4", identityName: "Writer", state: "ended", endedAt: 500 }),
  session({ sessionId: "s5", identityName: null, state: "working" }),
];

describe("the session join", () => {
  it("counts only live agents, and never an ended one", () => {
    expect(runningCount(CAPTAIN, SESSIONS)).toBe(2);
    const live = liveRuns([CAPTAIN, WRITER], SESSIONS);
    expect(live.map((r) => r.session.sessionId)).toEqual(["s1", "s2"]);
  });

  it("lists finished agents most recent first, and nothing live", () => {
    expect(endedRuns([CAPTAIN, WRITER], SESSIONS).map((r) => r.session.sessionId)).toEqual([
      "s3",
      "s4",
    ]);
  });

  it("lists a session once when two shelves hold a role of the same name", () => {
    const twin = identity({ id: "id-3", name: "Release captain" });
    expect(liveRuns([CAPTAIN, twin], SESSIONS)).toHaveLength(2);
  });

  it("keeps 'could not ask' apart from 'nothing ran'", () => {
    expect(lastUsedAt(CAPTAIN, null)).toBeNull();
    expect(liveRuns([CAPTAIN], null)).toEqual([]);
    expect(lastUsedAt(CAPTAIN, SESSIONS)).toBe(900);
  });
});

describe("search, filter and sort", () => {
  it("searches name, description and runtime, and filters by runtime", () => {
    const all = [CAPTAIN, WRITER];
    const by = (query: string, runtime = "all") =>
      arrangeIdentities(all, { ...DEFAULT_ARRANGEMENT, query, runtime }, null).map((i) => i.id);
    expect(by("notes")).toEqual(["id-2"]);
    expect(by("CLAUDE")).toEqual(["id-1"]);
    expect(by("", "codex")).toEqual(["id-2"]);
  });

  it("sorts by recent use, name or live agents", () => {
    const all = [WRITER, CAPTAIN];
    const sorted = (sort: "recent" | "name" | "running") =>
      arrangeIdentities(all, { ...DEFAULT_ARRANGEMENT, sort }, SESSIONS).map((i) => i.id);
    expect(sorted("recent")).toEqual(["id-1", "id-2"]);
    expect(sorted("name")).toEqual(["id-1", "id-2"]);
    expect(sorted("running")).toEqual(["id-1", "id-2"]);
  });
});

describe("runtime readiness", () => {
  const runtimes = [
    { id: "claude", label: "Claude" },
    { id: "codex", label: "Codex" },
  ];

  it("is unknown until the desktop has answered", () => {
    expect(runtimeReadiness({ runtimes, connected: [], connectedKnown: false })).toBeNull();
  });

  it("marks a runtime that is not signed in", () => {
    expect(runtimeReadiness({ runtimes, connected: ["claude"], connectedKnown: true })).toEqual([
      { id: "claude", label: "Claude", ready: true },
      { id: "codex", label: "Codex", ready: false },
    ]);
  });
});
