/**
 * THE EIGHT POSTURE COLUMNS, END TO END — what the service WRITES and what the
 * mapper HANDS BACK (2026-09-01, T24 + `set_agent_mode`).
 *
 * ⚠ **THE PROPERTY THIS SUITE EXISTS FOR IS THAT A FIELD CAN GO MISSING WITHOUT
 * ANYTHING FAILING.** `toDirective` is a literal whitelist and so is the
 * desktop's `directiveFrom`; a column the server writes and the mapper does not
 * name is dropped in silence, and the visible symptom is a lane that ships, files
 * rows, and does nothing. Every one of the eight is named individually below
 * rather than compared as an object, so the failure says WHICH.
 *
 * ⚠ **AND THE ECHO TRIO'S NULL IS ASSERTED AS NULL.** No machine writes those
 * columns yet, so `null` is the live value and it means "NOT REPORTED". The one
 * thing the mapper must never do is default them from the REQUEST — that would
 * make the row assert the machine applied exactly what was asked, which is the
 * single claim this lane cannot make about a value it clamps.
 *
 * ⚠ THE REPOSITORY IS MOCKED. This is about the shape crossing two boundaries,
 * not about SQL; the column CHECKs are the database's own statement and
 * `schema-sql.test.ts` reads them out of the migration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-launch", () => ({ insertLaunchDirective: vi.fn() }));
vi.mock("./repository-agent-owner", () => ({ agentInstanceOwner: vi.fn() }));
vi.mock("./repository-collab", () => ({ presenceForWorkspace: vi.fn() }));
vi.mock("./repository-tasks", () => ({ findTaskByChannelAndId: vi.fn() }));
vi.mock("./service-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service-shared")>();
  return { ...actual, loadVisibleChannel: vi.fn() };
});
// ⚠ MOCKED THOUGH NO TEST HERE NAMES A TEMPLATE: `service-launch.ts` pulls the
// agent-templates barrel at module scope — `server-only`, with a live Supabase
// admin client under it. The same mock its own suite carries.
vi.mock("@/features/agent-templates/server/service", () => ({
  resolveTemplateRef: vi.fn(),
}));

import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import { agentInstanceOwner } from "./repository-agent-owner";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
import { createLaunchDirective } from "./service-launch";
import { createAgentDirective } from "./service-launch-agent";
import { toDirective } from "./service-launch-dto";
import { LAUNCH_DIRECTIVE_TTL_MS } from "../constants";

const WS = "22222222-2222-2222-2222-222222222222";
const ME = "33333333-3333-3333-3333-333333333333";
const CHAN = "11111111-1111-1111-1111-111111111111";
const DIR = "55555555-5555-5555-5555-555555555555";
const AGENT = "a1b2c3d4";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  source: "agent",
  role: "member",
};

const CHANNEL_ROW = { id: CHAN, slug: "general", name: "General", visibility: "private" };
const MEMBERSHIP = { channel_id: CHAN, user_id: ME, role: "member" };

function row(over: Record<string, unknown> = {}) {
  return {
    id: DIR,
    kind: "launch",
    workspace_id: WS,
    channel_id: CHAN,
    task_id: null,
    operator_user_id: ME,
    goal: null,
    model: null,
    template_id: null,
    template_name: null,
    target_agent_id: null,
    target_name: null,
    start_tool_mode: null,
    start_message_mode: null,
    chain: null,
    target_tool_mode: null,
    target_message_mode: null,
    applied_tool_mode: null,
    applied_message_mode: null,
    applied_chain: null,
    status: "pending",
    refusal_reason: null,
    agent_id: null,
    claimed_at: null,
    decided_at: null,
    expires_at: new Date(Date.now() + LAUNCH_DIRECTIVE_TTL_MS).toISOString(),
    created_at: new Date().toISOString(),
    ...over,
  };
}

/** The one insert this suite inspects. */
function inserted(): Record<string, unknown> {
  const call = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0];
  return call[1] as unknown as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadVisibleChannel).mockResolvedValue({
    channel: CHANNEL_ROW,
    membership: MEMBERSHIP,
  } as never);
  // ONLINE: presence is the last gate and every case here is about what is
  // written, not about whether anything is.
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
    new Map([[ME, { lastSeenAt: new Date().toISOString() }]]) as never,
  );
  vi.mocked(agentInstanceOwner).mockResolvedValue(null);
  vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(row() as never);
});

describe("createLaunchDirective persists the T24 request", () => {
  it("writes both axes and the chain under their column names", async () => {
    await createLaunchDirective(ctx, {
      channel: "general",
      tools: "auto",
      messages: "auto_outbound",
      chain: true,
    });
    const ins = inserted();
    expect(ins.start_tool_mode).toBe("auto");
    expect(ins.start_message_mode).toBe("auto_outbound");
    expect(ins.chain).toBe(true);
  });

  it("⚠ `chain: false` IS WRITTEN AS false, never as null", async () => {
    // `|| null` here would turn "run it with chaining off" into "did not ask",
    // which inherits the channel's setting and can be the opposite.
    await createLaunchDirective(ctx, { channel: "general", chain: false });
    expect(inserted().chain).toBe(false);
  });

  it("a launch that asks for nothing writes null on all three — the pre-T24 row", async () => {
    await createLaunchDirective(ctx, { channel: "general", goal: "do a thing" });
    const ins = inserted();
    expect(ins.start_tool_mode).toBeNull();
    expect(ins.start_message_mode).toBeNull();
    expect(ins.chain).toBeNull();
  });

  it("⚠ NEVER writes the SET-MODE pair — the column CHECK refuses it at rest", async () => {
    await createLaunchDirective(ctx, { channel: "general", tools: "bypass" });
    const ins = inserted();
    expect(ins.target_tool_mode).toBeUndefined();
    expect(ins.target_message_mode).toBeUndefined();
  });

  it("⚠ NEVER writes an ECHO column — the machine reports those, not the asker", async () => {
    await createLaunchDirective(ctx, { channel: "general", tools: "auto" });
    const ins = inserted();
    expect(ins.applied_tool_mode).toBeUndefined();
    expect(ins.applied_message_mode).toBeUndefined();
    expect(ins.applied_chain).toBeUndefined();
  });
});

describe("createAgentDirective persists the set_agent_mode request", () => {
  it("writes the kind and both target modes", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(
      row({ kind: "set_agent_mode", target_agent_id: AGENT }) as never,
    );
    await createAgentDirective(ctx, {
      kind: "set_agent_mode",
      channel: "general",
      agentId: AGENT,
      tools: "accept_edits",
      messages: "auto_both",
    });
    const ins = inserted();
    expect(ins.kind).toBe("set_agent_mode");
    expect(ins.target_agent_id).toBe(AGENT);
    expect(ins.target_tool_mode).toBe("accept_edits");
    expect(ins.target_message_mode).toBe("auto_both");
  });

  it("one axis alone writes null for the other — 'leave it alone', not 'narrowest'", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(
      row({ kind: "set_agent_mode", target_agent_id: AGENT }) as never,
    );
    await createAgentDirective(ctx, {
      kind: "set_agent_mode",
      channel: "general",
      agentId: AGENT,
      tools: "auto",
    });
    expect(inserted().target_message_mode).toBeNull();
  });

  it("⚠ an END writes NO posture at all, on either pair", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(
      row({ kind: "end", target_agent_id: AGENT }) as never,
    );
    await createAgentDirective(ctx, {
      kind: "end",
      channel: "general",
      agentId: AGENT,
    });
    const ins = inserted();
    expect(ins.target_tool_mode).toBeNull();
    expect(ins.target_message_mode).toBeNull();
    expect(ins.start_tool_mode).toBeUndefined();
    expect(ins.chain).toBeUndefined();
  });
});

describe("toDirective hands back all eight columns", () => {
  const now = Date.now();

  it("maps the five REQUEST columns to camelCase, value for value", () => {
    const d = toDirective(
      row({
        kind: "set_agent_mode",
        start_tool_mode: "auto",
        start_message_mode: "auto_inbound",
        chain: true,
        target_tool_mode: "bypass",
        target_message_mode: "auto_both",
      }) as never,
      now,
    );
    // ⚠ NAMED ONE BY ONE. The desktop's `directiveFrom` reads exactly these
    // camelCase spellings off the CLAIM's answer, so a single missing key is a
    // request half that silently never arrives.
    expect(d.startToolMode).toBe("auto");
    expect(d.startMessageMode).toBe("auto_inbound");
    expect(d.chain).toBe(true);
    expect(d.targetToolMode).toBe("bypass");
    expect(d.targetMessageMode).toBe("auto_both");
  });

  it("🔒 the ECHO trio comes back as null, NOT defaulted from the request", () => {
    const d = toDirective(
      row({ start_tool_mode: "bypass", start_message_mode: "auto_both", chain: true }) as never,
      now,
    );
    expect(d.appliedToolMode).toBeNull();
    expect(d.appliedMessageMode).toBeNull();
    expect(d.appliedChain).toBeNull();
  });

  it("carries `set_agent_mode` through as a kind rather than collapsing it to launch", () => {
    expect(toDirective(row({ kind: "set_agent_mode" }) as never, now).kind).toBe(
      "set_agent_mode",
    );
  });

  it("an unknown kind still collapses to launch — the fail-safe fallback is intact", () => {
    expect(toDirective(row({ kind: "teleport" }) as never, now).kind).toBe("launch");
  });

  it("⚠ a STALE CACHED PAYLOAD missing every new column maps to null, never undefined", () => {
    // A payload cached against an older PostgREST schema arrives without the
    // fields; `undefined` renders as the string "undefined" inside a sentence
    // naming what an agent was allowed to do.
    const stale = row();
    for (const k of [
      "start_tool_mode",
      "start_message_mode",
      "chain",
      "target_tool_mode",
      "target_message_mode",
      "applied_tool_mode",
      "applied_message_mode",
      "applied_chain",
    ]) {
      delete (stale as Record<string, unknown>)[k];
    }
    const d = toDirective(stale as never, now);
    for (const v of [
      d.startToolMode,
      d.startMessageMode,
      d.chain,
      d.targetToolMode,
      d.targetMessageMode,
      d.appliedToolMode,
      d.appliedMessageMode,
      d.appliedChain,
    ]) {
      expect(v).toBeNull();
    }
  });
});
