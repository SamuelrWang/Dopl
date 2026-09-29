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

describe("metadata.display", () => {
  it("stamps a validated display with a server screen id", async () => {
    await post(agent, {
      body: "Usage 62%",
      display: {
        blocks: [
          { type: "text", content: "Usage" },
          { type: "progress", value: 0.62, label: "Credits" },
          { type: "list", items: ["Top up", "Later"] },
        ],
        wait_for_input: true,
      },
    });
    const display = stored().display as Record<string, unknown>;
    expect(display).toMatchObject({ spec_version: 1, wait_for_input: true });
    expect(display.screen_id).toMatch(/^d-[0-9a-f]{8}$/);
    expect((display.blocks as { id: string; type: string }[]).map((b) => [b.id, b.type])).toEqual([
      ["b1", "text"],
      ["b2", "progress"],
      ["b3", "list"],
    ]);
    expect(display).not.toHaveProperty("glasses_message_id");
  });

  it("survives a RECORD from an EXTERNAL session (intent chat, no desktop runtime) — 2026-09-28", async () => {
    await post({ ...agent, runtime: undefined }, {
      body: "[demo] portfolio",
      intent: "chat",
      display: { blocks: [{ type: "text", content: "AAPL", x: 8, y: 8, w: 270, h: 35 }], layout: "absolute" },
    });
    const meta = stored();
    expect(meta).toMatchObject({ intent: "chat", external_session: true });
    expect(meta.display).toMatchObject({ spec_version: 1, layout: "absolute" });
  });

  it("strips a display smuggled through caller metadata", async () => {
    await post(agent, { body: "x", metadata: { display: { spec_version: 1, glasses_message_id: "g", blocks: [] } } });
    expect(stored()).not.toHaveProperty("display");
  });

  it("refuses an invalid display at the schema (two selectable lists)", () => {
    const res = ChannelMessageCreateSchema.safeParse({
      body: "x",
      display: { blocks: [{ type: "list", items: ["a"] }, { type: "list", items: ["b"] }] },
    });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("selectable");
  });
});
