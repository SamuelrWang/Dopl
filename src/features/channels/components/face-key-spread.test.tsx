// @vitest-environment jsdom
/**
 * A face handed to `IdentityFace` as spread props must not carry `key`: React warns when a props
 * object holding `key` is spread into JSX. A key belongs only on the `IdentityStack` item list,
 * which destructures it. Every surface that spreads a face into `IdentityFace` renders here with
 * `console.error` spied.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { request } = vi.hoisted(() => ({
  request: vi.fn<(path: string, opts?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("@/shared/api/api-client", async () => {
  const envelope = await import("@/shared/api/api-envelope");
  return { ...envelope, apiRequest: request };
});

import { AgentFace } from "./agent-face";
import { AgentPanelHeader } from "./agent-panel-header";
import { StreamCard } from "./agent-stream-card";
import { ArtifactsTab } from "./artifacts-tab";
import { TasksPanel } from "./tasks-panel";
import { taskFaceResolver } from "./task-faces";
import { ThreadsTab } from "./threads-tab";
import { indexMembers } from "./view-model";
import { member, message, sessionSummary, thread, ME, PEER } from "./test-fixtures";
import { AGENT_ID, VIEWER, makeDetail, makeTask } from "./_task-fixtures";

const AGENT = "triage01";
const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang", avatarUrl: "https://x.test/me.png" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME,
  new Map([
    [AGENT, { displayName: "Debt Triage", description: null, color: "agent-02" as const }],
    [AGENT_ID, { displayName: "Backlog Scout", description: null, color: "agent-03" as const }],
  ])
);
const FEEDS = { sessions: [sessionSummary({ agentId: AGENT, threadId: "t-a" })], peers: [] };
const FACE = { photo: "https://x.test/me.png", name: "Sam Wang", ring: "agent-02" as const };

let errors: MockInstance<typeof console.error>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  request.mockReset();
  request.mockImplementation(async (_path, opts) =>
    (opts?.query as { artifact?: string } | undefined)?.artifact
      ? {
          messages: [
            message({
              id: "m-1",
              seq: 1,
              authorKind: "agent",
              clientMsgId: null,
              metadata: { session_id: `ch-1::${AGENT}` },
            }),
            message({ id: "m-2", seq: 2, authorUserId: PEER }),
          ],
          truncated: false,
        }
      : {
          artifacts: [
            {
              artifact: {
                id: "art-1",
                channelId: "ch-1",
                workspaceId: "ws-1",
                name: "Run",
                summary: "",
                createdBy: ME,
                createdByAgent: AGENT,
                dissolvedAt: null,
                createdAt: new Date().toISOString(),
              },
              count: 2,
              firstSeq: 1,
              lastSeq: 2,
            },
          ],
          truncated: false,
        }
  );
});
afterEach(() => {
  errors.mockRestore();
  cleanup();
});

function keySpreadWarnings(): unknown[][] {
  return errors.mock.calls.filter((args) =>
    args.some((a) => typeof a === "string" && a.includes('"key" prop is being spread'))
  );
}

describe("no face carries a key into a spread", () => {
  it("the Threads and Artifacts faces, list and opened", async () => {
    render(
      <ThreadsTab
        threads={[thread({ id: "t-a", title: "Alpha" })]}
        truncated={false}
        loading={false}
        index={INDEX}
        feeds={FEEDS}
        openThreadId={null}
        onOpenThread={() => {}}
      />
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ArtifactsTab channelId="ch-1" workspaceId="ws-1" index={INDEX} feeds={FEEDS} />
      </QueryClientProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open Run" }));
    await screen.findByRole("list", { name: "Messages" });
    expect(keySpreadWarnings()).toEqual([]);
  });

  it("the Tasks list, detail, subtasks and notes", () => {
    const faceOf = taskFaceResolver(INDEX, { sessions: [], peers: [] }, () => null);
    const task = makeTask({ createdBy: { kind: "person", userId: VIEWER } });
    const props = {
      tasks: [task],
      faceOf,
      detail: makeDetail(),
      onOpenTask: () => {},
      onOpenLink: () => {},
      onAddNote: async () => undefined,
    };
    const { rerender } = render(<TasksPanel {...props} openTaskId={null} />);
    rerender(<TasksPanel {...props} openTaskId={task.id} />);
    expect(screen.getByRole("article", { name: task.title })).toBeTruthy();
    expect(keySpreadWarnings()).toEqual([]);
  });

  it("the agent face, the agent view's header and the stream card", () => {
    render(<AgentFace size="s" photo={FACE.photo} name="Debt Triage" color="agent-02" runtime={null} />);
    render(<AgentPanelHeader agent={sessionSummary({ agentId: AGENT })} face={FACE} onClose={() => {}} />);
    render(
      <StreamCard edge={null} face={FACE} label="Posted" at={Date.now()}>
        body
      </StreamCard>
    );
    expect(keySpreadWarnings()).toEqual([]);
  });
});
