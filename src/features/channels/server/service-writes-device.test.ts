/**
 * The two device-aware reserved keys (docs/specs/device-aware-messages.md), through `postMessage`:
 * `metadata.source` rides a MEMBER post only and is never caller-settable; `metadata.display` is
 * stamped from the validated `display` field and never from caller metadata.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository");
vi.mock("./repository-sessions");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import * as repoMessages from "./repository-messages";
import { postMessage } from "./service-writes";
import { ChannelMessageCreateSchema } from "../schema";
import type { ChannelMessageRow, ChannelRow } from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const GLASSES = { kind: "glasses" as const, device_id: "dev-1", label: "Even G2", platform: "even_g2" };
const member: ChannelContext = { workspaceId: WS, userId: USER, credentialSubjectUserId: USER, source: "user", role: "member", messageSource: GLASSES };
const agent: ChannelContext = { ...member, source: "agent" };

const channel = { id: "chan-1", workspace_id: WS, slug: "room", is_direct: false, direct_key: null, deleted_at: null, archived_at: null } as unknown as ChannelRow;
const stored = () => vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata as Record<string, unknown>;
const post = (ctx: ChannelContext, raw: unknown) => postMessage(ctx, "room", ChannelMessageCreateSchema.parse(raw));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([]);
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channel);
  vi.mocked(repo.findMembership).mockResolvedValue({ user_id: USER } as never);
  vi.mocked(repo.listMembers).mockResolvedValue([]);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => ({ ...row, id: "m1", seq: 1, created_at: "2026-09-28T00:00:00Z" }) as ChannelMessageRow);
});

describe("metadata.source", () => {
  it("stamps the member's device on a member post", async () => {
    await post(member, { body: "hi" });
    expect(stored().source).toEqual(GLASSES);
  });

  it("strips a caller-supplied source (spoofing) and stamps the server's", async () => {
    await post(member, { body: "hi", metadata: { source: { kind: "computer", label: "Fake" } } });
    expect(stored().source).toEqual(GLASSES);
  });

  it("never rides an agent post — agent credential or a cookie post claiming agent", async () => {
    await post(agent, { body: "hi", metadata: { source: { kind: "glasses", label: "Forged" } } });
    expect(stored()).not.toHaveProperty("source");
    vi.mocked(repoMessages.insertMessage).mockClear();
    await post(member, { body: "done", authorKind: "agent" });
    expect(stored()).not.toHaveProperty("source");
  });

  it("stamps nothing when the door resolved no source", async () => {
    await post({ ...member, messageSource: undefined }, { body: "hi" });
    expect(stored()).not.toHaveProperty("source");
  });
});

describe("metadata.display (unified display, v2)", () => {
  const CHOICE = { type: "choice", options: [{ label: "Ship", description: "Live in 10m", recommended: true, why: "Reversible" }, { label: "Wait" }] };

  it("stamps a validated v2 display with a server display id, and no decision index without a choice", async () => {
    await post(agent, {
      body: "Usage 62%",
      display: { blocks: [{ type: "heading", text: "Usage" }, { type: "progress", value: 0.62, label: "Credits" }] },
    });
    const meta = stored();
    const display = meta.display as Record<string, unknown>;
    expect(display).toMatchObject({ spec_version: 2, origin: "dopl_show" });
    expect(display.display_id).toMatch(/^d-[0-9a-f]{8}$/);
    expect((display.blocks as { id: string; type: string }[]).map((b) => [b.id, b.type])).toEqual([["b1", "heading"], ["b2", "progress"]]);
    expect(meta).not.toHaveProperty("escalation");
  });

  it("a display with a choice IS a decision: the server stamps the decision index", async () => {
    await post(agent, { body: "x", display: { blocks: [{ type: "heading", text: "Ship it?" }, CHOICE] } });
    expect(stored().escalation).toEqual({
      issue: "Ship it?",
      context: "",
      options: [{ label: "Ship", consequence: "Live in 10m" }, { label: "Wait", consequence: "" }],
      recommendation: { index: 0, why: "Reversible" },
    });
  });

  it("dopl_request_decision's escalation gets a display built from it", async () => {
    const escalation = { issue: "Q?", context: "", options: [{ label: "A", consequence: "a" }, { label: "B", consequence: "b" }] };
    await post(agent, { body: "x", escalation });
    expect(stored().display).toMatchObject({
      spec_version: 2,
      origin: "dopl_request_decision",
      blocks: [{ id: "issue", type: "text", content: "Q?" }, { id: "decision", type: "choice", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }],
    });
  });

  it("refuses escalation and display together, and an invalid display", () => {
    const both = ChannelMessageCreateSchema.safeParse({
      body: "x",
      escalation: { issue: "Q", context: "", options: [{ label: "A", consequence: "a" }, { label: "B", consequence: "b" }] },
      display: { blocks: [CHOICE] },
    });
    expect(both.success).toBe(false);
    const two = ChannelMessageCreateSchema.safeParse({ body: "x", display: { blocks: [CHOICE, CHOICE] } });
    expect(JSON.stringify(two.error?.issues)).toContain("max 1 per display");
  });

  it("strips a display smuggled through caller metadata", async () => {
    await post(agent, { body: "x", metadata: { display: { spec_version: 2, glasses_message_id: "g", blocks: [] } } });
    expect(stored()).not.toHaveProperty("display");
  });
});

describe("display nudge", () => {
  it("hints choice on an agent's plain send that lists options with a question, and never on a record", async () => {
    const res = await post(agent, { body: "Which should I do?\n1. Ship now\n2. Wait for review" });
    expect(res.displayHint).toBe("choice");
    const record = await post(agent, { body: "Which should I do?\n1. Ship now\n2. Wait for review", intent: "chat" });
    expect(record.displayHint).toBeUndefined();
    const byMember = await post(member, { body: "Which should I do?\n1. Ship now\n2. Wait for review" });
    expect(byMember.displayHint).toBeUndefined();
  });
});
