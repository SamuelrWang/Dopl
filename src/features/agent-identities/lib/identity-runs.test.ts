import { describe, expect, it } from "vitest";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { identity } from "../components/identity-editor-harness";
import {
  DEFAULT_ARRANGEMENT,
  arrangeIdentities,
  endedRuns,
  joinRuns,
  liveRuns,
  usageFor,
  usageOf,
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
  session({ sessionId: "s1", identityId: "id-1", identityName: "Release captain", state: "working", startedAt: 100 }),
  session({ sessionId: "s2", identityId: "id-1", identityName: "Release captain", state: "idle", startedAt: 300 }),
  session({ sessionId: "s3", identityId: "id-1", identityName: "Release captain", state: "ended", endedAt: 900 }),
  session({ sessionId: "s4", identityId: "id-2", identityName: "Writer", state: "ended", endedAt: 500 }),
  session({ sessionId: "s5", identityName: null, state: "working" }),
];
const runs = joinRuns([CAPTAIN, WRITER], SESSIONS);
const ids = (list: ReadonlyArray<{ session: DesktopSessionSummary }>) =>
  list.map((r) => r.session.sessionId);

describe("the session join", () => {
  it("credits each session by its stamped id, and drops one with no identity", () => {
    expect(ids(runs)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("follows the id over the name: a renamed identity keeps its agents", () => {
    const renamed = identity({ id: "id-1", name: "Captain" });
    expect(ids(joinRuns([renamed], SESSIONS))).toEqual(["s1", "s2", "s3"]);
  });

  it("credits a session once when two rows share a name", () => {
    const twin = identity({ id: "id-9", name: "Release captain" });
    expect(joinRuns([CAPTAIN, twin], SESSIONS).every((r) => r.identity.id === "id-1")).toBe(true);
  });

  it("falls back to the name only for a session with no id, collapsing whitespace", () => {
    const legacy = session({ sessionId: "old", identityName: "  Release   captain " });
    expect(ids(joinRuns([CAPTAIN], [legacy]))).toEqual(["old"]);
  });

  it("…and a SHARED row must also be in the session's own workspace", () => {
    const shared = identity({ id: "id-s", name: "Intake", visibility: "workspace", workspaceId: "ws-a" });
    const here = session({ sessionId: "here", identityName: "Intake", workspaceId: "ws-a" });
    const there = session({ sessionId: "there", identityName: "Intake", workspaceId: "ws-b" });
    expect(ids(joinRuns([shared], [here, there]))).toEqual(["here"]);
  });

  it("lists live agents working first, and finished ones only as ended", () => {
    expect(ids(liveRuns(runs))).toEqual(["s1", "s2"]);
    expect(ids(endedRuns(runs))).toEqual(["s3", "s4"]);
  });

  it("counts use per identity, and keeps 'nothing on record' apart", () => {
    const use = usageOf(runs);
    expect(usageFor(use, CAPTAIN)).toEqual({ running: 2, lastUsed: 900 });
    expect(usageFor(usageOf(joinRuns([CAPTAIN], null)), CAPTAIN)).toEqual({ running: 0, lastUsed: null });
  });
});

describe("search, filter and sort", () => {
  const use = usageOf(runs);

  it("searches name, description and runtime, and filters by runtime", () => {
    const by = (query: string, runtime = "all") =>
      arrangeIdentities([CAPTAIN, WRITER], { ...DEFAULT_ARRANGEMENT, query, runtime }, use).map(
        (i) => i.id
      );
    expect(by("notes")).toEqual(["id-2"]);
    expect(by("CLAUDE")).toEqual(["id-1"]);
    expect(by("", "codex")).toEqual(["id-2"]);
  });

  it("sorts by recent use, name or live agents", () => {
    const sorted = (sort: "recent" | "name" | "running") =>
      arrangeIdentities([WRITER, CAPTAIN], { ...DEFAULT_ARRANGEMENT, sort }, use).map((i) => i.id);
    expect(sorted("recent")).toEqual(["id-1", "id-2"]);
    expect(sorted("name")).toEqual(["id-1", "id-2"]);
    expect(sorted("running")).toEqual(["id-1", "id-2"]);
  });
});
