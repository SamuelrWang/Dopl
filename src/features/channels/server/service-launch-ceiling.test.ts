import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-launch", () => ({
  insertLaunchDirective: vi.fn(),
  findLaunchDirectiveByClientMsgId: vi.fn(),
}));
vi.mock("./repository-collab", () => ({ presenceForWorkspace: vi.fn() }));
vi.mock("./repository-tasks", () => ({ findTaskByChannelAndId: vi.fn() }));
vi.mock("./service-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service-shared")>();
  return { ...actual, loadVisibleChannel: vi.fn() };
});
vi.mock("@/features/agent-templates/server/service", () => ({
  resolveTemplateRef: vi.fn(),
}));

import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
import { createLaunchDirective } from "./service-launch";
import { ChannelAgentChainForbiddenError } from "./errors";
import { LAUNCH_DIRECTIVE_TTL_MS } from "../constants";

/**
 * **THE SERVER-SIDE POSTURE CEILING** (2026-09-02, A9 — guardrails G6, G7, G8).
 *
 * ⚠ **WHAT THESE THREE GUARDRAILS ACTUALLY RECORDED IS AN ABSENCE.** *"Your
 * operator's machine narrows what you ask; it never widens"* was true only while
 * a machine was listening — the ceiling lived in an `electron-store` record no
 * server could read, so an offline or older desktop narrowed nothing and refused
 * nothing. Every case below is about what happens with no machine in the loop.
 *
 * ⚠ **AND ABOUT WHAT MUST *NOT* HAPPEN WITH NO CEILING RECORDED.** A channel that
 * has never had one behaves exactly as it does today; a clamp invented from an
 * absence is a server refusing what it was never told to refuse.
 */

const WS = "22222222-2222-2222-2222-222222222222";
const ME = "33333333-3333-3333-3333-333333333333";
const CHAN = "11111111-1111-1111-1111-111111111111";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  source: "agent",
  role: "member",
};

/** A channel ROW, ceiling-free unless a case records one. */
function channelRow(over: Record<string, unknown> = {}) {
  return { id: CHAN, slug: "general", name: "General", visibility: "private", ...over };
}

function inserted(): Record<string, unknown> {
  const call = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0];
  return call[1] as unknown as Record<string, unknown>;
}

function withCeiling(over: Record<string, unknown>): void {
  vi.mocked(loadVisibleChannel).mockResolvedValue({
    channel: channelRow(over),
    membership: { channel_id: CHAN, user_id: ME, role: "member" },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  withCeiling({});
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
    new Map([[ME, { lastSeenAt: new Date().toISOString(), online: true }]]) as never
  );
  vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(null);
  vi.mocked(launchRepo.insertLaunchDirective).mockImplementation(
    async (_op, input) =>
      ({
        // ⚠ THE INSERT'S OWN FIELDS WIN — this is the row the database would hand
        // back, so the spread comes LAST and the defaults below it are only what
        // the insert does not carry.
        id: "55555555-5555-4555-8555-555555555555",
        kind: "launch",
        operator_user_id: ME,
        status: "pending",
        refusal_reason: null,
        agent_id: null,
        claimed_at: null,
        decided_at: null,
        created_at: new Date().toISOString(),
        ...input,
      }) as never
  );
});

describe("G6 — the posture is clamped at creation, and the resolution is stored", () => {
  it("narrows a request wider than the channel's ceiling", async () => {
    withCeiling({ agent_tool_ceiling: "accept_edits", agent_message_ceiling: "ask" });
    await createLaunchDirective(ctx, { channel: CHAN, tools: "bypass", messages: "auto_both" });
    expect(inserted()).toMatchObject({
      // ⚠ THE REQUEST IS RECORDED VERBATIM. `start_*` is a faithful record of what
      // was asked and is never rewritten — rewriting it would destroy the evidence
      // that a clamp happened at all.
      start_tool_mode: "bypass",
      start_message_mode: "auto_both",
      resolved_tool_mode: "accept_edits",
      resolved_message_mode: "ask",
    });
  });

  it("passes a request NARROWER than the ceiling straight through", async () => {
    withCeiling({ agent_tool_ceiling: "bypass" });
    await createLaunchDirective(ctx, { channel: CHAN, tools: "manual" });
    expect(inserted().resolved_tool_mode).toBe("manual");
  });

  it("a request that named NO posture stays unnamed — the machine's own pair applies", async () => {
    // ⚠ Substituting the ceiling here would silently turn "whatever the OPERATOR
    // chose" into "whatever this channel allows", which is a different launch.
    withCeiling({ agent_tool_ceiling: "manual", agent_message_ceiling: "ask" });
    await createLaunchDirective(ctx, { channel: CHAN });
    expect(inserted()).toMatchObject({
      resolved_tool_mode: null,
      resolved_message_mode: null,
    });
  });

  it("an UNRECORDED ceiling clamps nothing — today's behaviour, exactly", async () => {
    await createLaunchDirective(ctx, { channel: CHAN, tools: "bypass", messages: "auto_both" });
    expect(inserted()).toMatchObject({
      resolved_tool_mode: "bypass",
      resolved_message_mode: "auto_both",
    });
  });

  it("clamps each axis against its OWN ceiling, independently", async () => {
    withCeiling({ agent_tool_ceiling: "manual" });
    await createLaunchDirective(ctx, { channel: CHAN, tools: "bypass", messages: "auto_both" });
    expect(inserted()).toMatchObject({
      resolved_tool_mode: "manual",
      resolved_message_mode: "auto_both",
    });
  });
});

describe("G7 — `chain` is REFUSED, never clamped", () => {
  it("400s when the channel forbids chaining, and names the setting", async () => {
    // ⚠ A clamped chain produces an agent that hits a bound it was told it did not
    // have, mid-run, after the orchestrator handed it work assuming workers. That
    // is why this is the one axis that refuses.
    withCeiling({ agent_chain_allowed: false });
    const err = await createLaunchDirective(ctx, { channel: CHAN, chain: true }).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(ChannelAgentChainForbiddenError);
    expect(String(err.message)).toContain("channelAgentChain");
    expect(vi.mocked(launchRepo.insertLaunchDirective)).not.toHaveBeenCalled();
  });

  it("`chain: false` is ALWAYS granted — it can only ever narrow", async () => {
    withCeiling({ agent_chain_allowed: false });
    await createLaunchDirective(ctx, { channel: CHAN, chain: false });
    expect(inserted().resolved_chain).toBe(false);
  });

  it("`chain: false` WINS over a channel set to ON — that is the point of sending it", async () => {
    withCeiling({ agent_chain_allowed: true });
    await createLaunchDirective(ctx, { channel: CHAN, chain: false });
    expect(inserted().resolved_chain).toBe(false);
  });

  it("not asking inherits silently where the channel allows it", async () => {
    withCeiling({ agent_chain_allowed: true });
    await createLaunchDirective(ctx, { channel: CHAN });
    expect(inserted().resolved_chain).toBeNull();
  });

  it("not asking resolves to FALSE where the channel forbids it — never a refusal", async () => {
    withCeiling({ agent_chain_allowed: false });
    await createLaunchDirective(ctx, { channel: CHAN });
    expect(inserted().resolved_chain).toBe(false);
  });

  it("an UNRECORDED chain ceiling refuses nothing — the desktop toggle answers", async () => {
    await createLaunchDirective(ctx, { channel: CHAN, chain: true });
    expect(inserted().resolved_chain).toBe(true);
  });
});

describe("G8 — the model is ECHOED, never refused", () => {
  it("resolves a known id to itself", async () => {
    await createLaunchDirective(ctx, { channel: CHAN, model: "claude-opus-5" });
    expect(inserted()).toMatchObject({
      model: "claude-opus-5",
      resolved_model: "claude-opus-5",
    });
  });

  it("resolves a bare ALIAS to its canonical id — the machine accepts both", async () => {
    await createLaunchDirective(ctx, { channel: CHAN, model: "sonnet" });
    expect(inserted().resolved_model).toBe("claude-sonnet-5");
  });

  it("an UNRECOGNISED id is carried unchanged and echoed as null — not refused", async () => {
    // ⚠ THE WHOLE OF G8. The silent fallback is `main/session-model.js ›
    // normalizeModelId` failing closed; a 400 here would refuse a model a NEWER
    // desktop runs happily, which is a narrowing nobody ruled. So the request
    // survives and the null says "this server did not recognise it".
    await createLaunchDirective(ctx, { channel: CHAN, model: "claude-from-the-future" });
    expect(inserted()).toMatchObject({
      model: "claude-from-the-future",
      resolved_model: null,
    });
  });

  it("a PROTOTYPE key is not a model — `constructor` resolves to null like any other word", async () => {
    // 🔒 THE ALIAS TABLE IS INDEXED WITH CALLER TEXT (2026-09-02). A bare
    // `ALIASES[key]` walks `Object.prototype`, so `"constructor"` answered the
    // `Object` FUNCTION and `?? null` never fired — `resolveAgentModelId`'s
    // `string | null` return type was false for a value anybody could send, and
    // the value went into `resolved_model` and onto the launch line.
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      vi.mocked(launchRepo.insertLaunchDirective).mockClear();
      await createLaunchDirective(ctx, { channel: CHAN, model: key });
      expect(inserted(), key).toMatchObject({ model: key, resolved_model: null });
    }
  });

  it("asking for no model resolves to null, which is the same shape as unrecognised", async () => {
    // ⚠ The two are told apart by `model` itself, which is why both live on the
    // row: null/null is "did not ask", set/null is "asked and unrecognised".
    await createLaunchDirective(ctx, { channel: CHAN });
    expect(inserted()).toMatchObject({ model: null, resolved_model: null });
  });
});

describe("the ceiling is decided in the right ORDER", () => {
  it("refuses a forbidden chain even when the operator is OFFLINE", async () => {
    // ⚠ `offline` is a 200 saying "nothing was asked". Answering a forbidden chain
    // with "your machine is asleep" makes the caller fix the wrong thing and ask
    // again a minute later for the real refusal.
    withCeiling({ agent_chain_allowed: false });
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    await expect(
      createLaunchDirective(ctx, { channel: CHAN, chain: true })
    ).rejects.toBeInstanceOf(ChannelAgentChainForbiddenError);
  });

  it("a converged idempotent retry is NOT re-decided against today's ceiling", async () => {
    // ⚠ A stored row is this request's answer. Re-clamping it would let a ceiling
    // that moved since turn a successful launch's retry into a refusal.
    withCeiling({ agent_chain_allowed: false });
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      kind: "launch",
      workspace_id: WS,
      channel_id: CHAN,
      operator_user_id: ME,
      chain: true,
      status: "pending",
      refusal_reason: null,
      agent_id: null,
      claimed_at: null,
      decided_at: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + LAUNCH_DIRECTIVE_TTL_MS).toISOString(),
    } as never);
    const out = await createLaunchDirective(ctx, {
      channel: CHAN,
      chain: true,
      clientMsgId: "k1",
    });
    expect(out).toMatchObject({ offline: false, existing: true });
    expect(vi.mocked(launchRepo.insertLaunchDirective)).not.toHaveBeenCalled();
  });
});
