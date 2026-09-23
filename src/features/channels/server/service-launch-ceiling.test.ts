import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-launch", () => ({
  insertLaunchDirective: vi.fn(),
  findLaunchDirectiveByClientMsgId: vi.fn(),
}));
vi.mock("./repository-collab", () => ({ presenceForWorkspace: vi.fn() }));
vi.mock("./repository-tasks", () => ({ findTaskByChannelAndId: vi.fn() }));
// ⚠ MOCKED IN EVERY LAUNCH SUITE THOUGH NONE OF THEM NAMES A COLOUR: the create's
// SIXTH gate (`service-launch-color.ts`) reads the channel's taken set, and that read
// is a live `supabaseAdmin()` client. The POLICY stays real — only the READ is
// stubbed — so these suites still execute the gate rather than skipping it, on the
// `repository-collab` precedent one line up. The colour cases are in
// `service-launch-color.test.ts`.
vi.mock("./repository-session-colors", () => ({
  foreignLiveColorsByChannel: vi.fn(async () => new Map()),
  // ⚠ THE SECOND READ THE GATE MAKES SINCE 2026-09-14 (pending directives hold their key
  // too). Stubbed for the same reason as the first: the POLICY stays real here, the READS
  // do not. Its own cases are in `service-launch-color.test.ts`.
  pendingDirectiveColors: vi.fn(async () => []),
}));
vi.mock("./service-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service-shared")>();
  return { ...actual, loadVisibleChannel: vi.fn() };
});
vi.mock("@/features/agent-identities/server/service", () => ({
  resolveIdentityRef: vi.fn(),
}));

import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
import { createLaunchDirective } from "./service-launch";
import { LAUNCH_DIRECTIVE_TTL_MS } from "../constants";

/**
 * **THE SERVER DECIDES NO POSTURE AND RESOLVES NO MODEL.** The channel ceiling is retired, so the
 * request is stored verbatim (`start_*` / `chain`) and the `resolved_*` group is written `null`
 * (F10); `resolved_model` is no longer looked up in Claude's frozen table on every runtime (F7).
 * The operator's machine clamps (`main/launch-posture.js`) and reports `applied_*`.
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

describe("a request is stored verbatim and never narrowed by the server", () => {
  it("does NOT narrow a request that the old ceiling would have clamped", async () => {
    withCeiling({ agent_tool_ceiling: "accept_edits", agent_message_ceiling: "ask" });
    await createLaunchDirective(ctx, { channel: CHAN, tools: "bypass", messages: "auto_both" });
    expect(inserted()).toMatchObject({
      start_tool_mode: "bypass",
      start_message_mode: "auto_both",
    });
  });

  // 🔒 F10: `resolved_*` was a byte copy of the request once the clamp was deleted, and MCP's
  // `allowed=` printed it as if the server had permitted something.
  it("writes the whole `resolved_*` group as NULL — the server permitted nothing", async () => {
    await createLaunchDirective(ctx, { channel: CHAN, tools: "bypass", messages: "auto_both", chain: true });
    expect(inserted()).toMatchObject({
      resolved_tool_mode: null,
      resolved_message_mode: null,
      resolved_chain: null,
      resolved_model: null,
    });
  });

  // C5 (ruling R3): a Codex launch may ask in Codex words.
  it("stores a Codex tool word verbatim", async () => {
    await createLaunchDirective(ctx, { channel: CHAN, runtime: "codex", tools: "on-request" });
    expect(inserted()).toMatchObject({ runtime: "codex", start_tool_mode: "on-request" });
  });

  it("a chain:true directive is GRANTED even where the channel forbade it", async () => {
    withCeiling({ agent_chain_allowed: false });
    await createLaunchDirective(ctx, { channel: CHAN, chain: true });
    expect(vi.mocked(launchRepo.insertLaunchDirective)).toHaveBeenCalledTimes(1);
    expect(inserted().chain).toBe(true);
  });

  it("`chain: false` still means false — the CALLER may always narrow itself", async () => {
    withCeiling({ agent_chain_allowed: true });
    await createLaunchDirective(ctx, { channel: CHAN, chain: false });
    expect(inserted().chain).toBe(false);
  });
});

// 🔒 F7: `launch_agent runtime=codex model=opus` got `resolved_model = "claude-opus-5"` off
// Claude's frozen alias table, and MCP printed it on a Codex launch the machine then refused.
describe("the model is carried verbatim and never resolved server-side", () => {
  it.each([
    ["claude-opus-5", undefined],
    ["sonnet", undefined],
    ["opus", "codex"],
    ["gpt-6-sol", "codex"],
    ["constructor", undefined],
  ])("model %s (runtime %s) is stored as asked, with resolved_model NULL", async (model, runtime) => {
    await createLaunchDirective(ctx, { channel: CHAN, model, runtime });
    expect(inserted()).toMatchObject({ model, resolved_model: null });
  });
});

describe("the ceiling is decided in the right ORDER", () => {
  it("an OFFLINE operator gets the offline answer — the retired ceiling has no say", async () => {
    // ⚠ **REWRITTEN 2026-09-06 WITH THE CEILING ITSELF.** This read "refuses a forbidden chain
    // even when the operator is OFFLINE" and pinned an ORDER: the refusal had to beat the
    // `offline` 200, because answering a forbidden chain with "your machine is asleep" makes the
    // caller fix the wrong thing and ask again a minute later for the real refusal. There is no
    // refusal to order any more — `agent_chain_allowed` is dropped — so what is left to state is
    // that the retired column changes nothing about the offline path either.
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
