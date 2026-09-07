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
  credentialSubjectUserId: ME,
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

/**
 * ── ⚠ **G6 AND G7 ARE RETIRED (2026-09-06, Samuel's rulings on items 12, 13 and 14)** ──────
 *
 * The channel ceiling is deleted end to end, so there is no clamp to pin and no refusal to
 * pin. These cases REPLACE the old G6/G7 suites and assert the opposite property: **a
 * directive gets exactly the posture it asked for, whatever the channel row still carries.**
 *
 * ⚠ **THEY DRIVE A ROW THAT STILL HAS THE OLD COLUMNS ON PURPOSE.** The migration is
 * non-destructive — the three `agent_*` columns remain and old values are not cleared — so
 * "a row carrying a ceiling no longer clamps" is the real production case, not a synthetic
 * one. A suite that only tested ceiling-free rows would pass without proving the removal.
 *
 * ⚠ **WHAT WAS LOST IS NAMED HERE RATHER THAN JUST DELETED.** G7 refused where G6 clamped,
 * because a clamped chain hands back an agent that hits a bound mid-run after its caller gave
 * it work assuming workers. Both are gone; no room bounds a peer's agent on any axis. The
 * OPERATOR's own clamp (`main/launch-posture.js`) is untouched and is a different thing.
 */
describe("the channel ceiling is retired — a request is no longer narrowed", () => {
  it("does NOT narrow a request that the old ceiling would have clamped", async () => {
    withCeiling({ agent_tool_ceiling: "accept_edits", agent_message_ceiling: "ask" });
    await createLaunchDirective(ctx, { channel: CHAN, tools: "bypass", messages: "auto_both" });
    expect(inserted()).toMatchObject({
      // ⚠ `start_*` STILL RECORDS THE REQUEST VERBATIM, unchanged by this wave.
      start_tool_mode: "bypass",
      start_message_mode: "auto_both",
      // …and `resolved_*` is now the same thing, because nothing narrows it.
      resolved_tool_mode: "bypass",
      resolved_message_mode: "auto_both",
    });
  });

  it("a request that named NO posture resolves to NULL, never to a stored ceiling", async () => {
    // ⚠ THIS IS THE CASE REVIEW D4 INVERTED, AND THE INVERSION IS THE RULING. D4 made an
    // unasked axis resolve to the CHANNEL'S ceiling so an orchestrator could tell "no ceiling
    // exists" from "nobody asked". There is no ceiling to substitute now, so `null` means the
    // only thing it can mean: the server states no opinion.
    withCeiling({ agent_tool_ceiling: "manual", agent_message_ceiling: "ask" });
    await createLaunchDirective(ctx, { channel: CHAN });
    expect(inserted()).toMatchObject({
      resolved_tool_mode: null,
      resolved_message_mode: null,
    });
  });

  it("a chain:true directive is GRANTED even where the channel forbade it", async () => {
    // ⚠ THE SHARPEST DELETION IN THE WAVE, PINNED SO IT CANNOT REGRESS SILENTLY. This used to
    // throw `ChannelAgentChainForbiddenError` and insert nothing.
    withCeiling({ agent_chain_allowed: false });
    await createLaunchDirective(ctx, { channel: CHAN, chain: true });
    expect(vi.mocked(launchRepo.insertLaunchDirective)).toHaveBeenCalledTimes(1);
    expect(inserted().resolved_chain).toBe(true);
  });

  it("nothing throws the retired refusal any more, on any row shape", async () => {
    // ⚠ ASSERTED ON THE ERROR CLASS ITSELF, because the class still EXISTS in `errors.ts` and
    // an import that still resolves is exactly how a deleted refusal comes back unnoticed.
    for (const row of [{ agent_chain_allowed: false }, { agent_chain_allowed: true }, {}]) {
      vi.clearAllMocks();
      withCeiling(row);
      vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(null);
      const err = await createLaunchDirective(ctx, { channel: CHAN, chain: true }).catch((e) => e);
      expect(err).not.toBeInstanceOf(ChannelAgentChainForbiddenError);
    }
  });

  it("`chain: false` still means false — the CALLER may always narrow itself", async () => {
    // ⚠ NOT A CEILING, AND THAT DISTINCTION SURVIVES THE WAVE. What died is one member
    // bounding another; a caller declining chaining for its own agent is untouched.
    withCeiling({ agent_chain_allowed: true });
    await createLaunchDirective(ctx, { channel: CHAN, chain: false });
    expect(inserted().resolved_chain).toBe(false);
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
  it("an OFFLINE operator gets the offline answer — the retired ceiling has no say", async () => {
    // ⚠ **REWRITTEN 2026-09-06 WITH THE CEILING ITSELF.** This read "refuses a forbidden chain
    // even when the operator is OFFLINE" and pinned an ORDER: the refusal had to beat the
    // `offline` 200, because answering a forbidden chain with "your machine is asleep" makes the
    // caller fix the wrong thing and ask again a minute later for the real refusal. There is no
    // refusal to order any more — `agent_chain_allowed` is dropped and nothing throws
    // `ChannelAgentChainForbiddenError` (the case above pins that on every row shape) — so what
    // is left to state is that the retired column changes nothing about the offline path either.
    withCeiling({ agent_chain_allowed: false });
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    const out = await createLaunchDirective(ctx, { channel: CHAN, chain: true });
    expect(out).toMatchObject({ offline: true });
    expect(vi.mocked(launchRepo.insertLaunchDirective)).not.toHaveBeenCalled();
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
