/**
 * THE "NEEDS YOU" SIGNAL'S SERVER FENCES — cited by name from `schema-ping.ts`
 * and `app/api/pings/route.ts` as the thing that asserts them, so it has to
 * exist and has to assert them.
 *
 * ⚠ **THE HEADLINE IS AN ABSENCE, AND IT IS THE WHOLE LOOP BRAKE.** Two of the
 * three recipient forms stamp `ctx.userId` as the RECIPIENT, and no schema and no
 * service signature on this path accepts an operator id — so an agent can never
 * ping another member's agent, because there is no field with which to say so.
 * The sender is stamped the same way, LAST, so no payload key can shadow it.
 *
 * The other properties that fail quietly:
 *  - **MEMBERSHIP, NOT READABILITY.** A public channel the caller never joined is
 *    a 404 — a ping is a signal about work in a room the sender belongs to.
 *  - **EXACTLY ONE RECIPIENT.** Zero is a signal with nowhere to go; two would
 *    make the service pick, and a silently-dropped address is the
 *    invisible-delivery failure the addressing contract exists to prevent.
 *  - **A SELF `to=` IS REFUSED NAMING THE INSTRUMENT THAT WORKS**, because the
 *    caller that reaches it is almost always an agent trying to reach its own
 *    operator's external session, which is what `toDesktop` spells.
 *  - **THE READ CARRIES BOTH FENCES `channel_pings_party_select` CARRIES** —
 *    party AND channel membership (R1, 2026-09-02) — and has no recipient
 *    parameter. It runs on the RLS-bypassing admin client, so the arguments ARE
 *    the access control, and party alone would make the REST answer wider than
 *    the client answer for a member who was removed from the room.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-pings");
vi.mock("./repository");
vi.mock("./repository-tasks");
vi.mock("./repository-await-workspace");
vi.mock("./service-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service-shared")>();
  return { ...actual, loadVisibleChannel: vi.fn() };
});

import * as pingRepo from "./repository-pings";
import * as repo from "./repository";
import * as repoTasks from "./repository-tasks";
import { listMemberChannelRefs } from "./repository-await-workspace";
import { loadVisibleChannel } from "./service-shared";
import { createPing, listPings } from "./service-pings";
import { PingCreateSchema } from "../schema-ping";
import type { ChannelContext } from "./service-shared";

const WS = "11111111-2222-3333-4444-555555555555";
const ME = "22222222-3333-4444-5555-666666666666";
const PEER = "77777777-8888-9999-aaaa-bbbbbbbbbbbb";
const CH = "33333333-4444-5555-6666-777777777777";
const PID = "44444444-5555-6666-7777-888888888888";
const TASK = "55555555-6666-7777-8888-999999999999";
const AGENT = "k3wpf7c5";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  credentialSubjectUserId: ME,
  source: "agent",
  role: "member",
};

const channelRow = { id: CH, slug: "build", name: "Build", workspace_id: WS };

function row(over: Record<string, unknown> = {}) {
  return {
    id: PID,
    seq: 12,
    workspace_id: WS,
    channel_id: CH,
    task_id: null,
    sender_user_id: ME,
    sender_agent_id: null,
    recipient_kind: "desktop",
    recipient_user_id: ME,
    recipient_agent_id: null,
    kind: "done",
    body: "shipped the migration",
    created_at: new Date().toISOString(),
    ...over,
  };
}

/** The three recipient forms, as the tool sends them. */
const BASE = { channel: "build", kind: "done" as const, body: "done here" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadVisibleChannel).mockResolvedValue({
    channel: channelRow,
    membership: { role: "member" },
  } as never);
  vi.mocked(pingRepo.insertPing).mockImplementation(
    async (_sender, input) => row({ ...input }) as never
  );
  vi.mocked(repo.findMembership).mockResolvedValue({ role: "member" } as never);
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true as never);
  vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue({
    id: TASK,
  } as never);
  vi.mocked(pingRepo.listPingsForRecipient).mockResolvedValue([row()] as never);
  vi.mocked(listMemberChannelRefs).mockResolvedValue([
    { id: CH, name: "Build", slug: "build" },
  ] as never);
});

describe("🔒 the sender is ctx.userId and can never be a parameter", () => {
  it("passes it as a SEPARATE positional argument, not inside the payload", async () => {
    await createPing(ctx, { ...BASE, toDesktop: true });
    const [sender, payload] = vi.mocked(pingRepo.insertPing).mock.calls[0];
    expect(sender).toBe(ME);
    // ⚠ The whole wire, pinned. A new key here is a review question, not a
    // silent widening — this is the object a request body could reach.
    expect(Object.keys(payload).sort()).toEqual([
      "body",
      "channel_id",
      "kind",
      "recipient_agent_id",
      "recipient_kind",
      "recipient_user_id",
      "sender_agent_id",
      "task_id",
      "workspace_id",
    ]);
  });

  it("declares no sender or operator field on the create schema at all", () => {
    // ⚠ Not "declared and ignored" — a field a client can see is a field a model
    // will try, and the absence IS the authorization story.
    const shape = Object.keys(PingCreateSchema.shape).sort();
    expect(shape).toEqual([
      "agentId",
      "body",
      "channel",
      "kind",
      "threadId",
      "to",
      "toDesktop",
    ]);
  });
});

describe("🔒 an agent can never ping another member's agent", () => {
  it("stamps ctx.userId as the RECIPIENT for agentId, ignoring anything else sent", async () => {
    await createPing(ctx, {
      ...BASE,
      agentId: AGENT,
      // A caller trying to name somebody else's machine. There is no field for
      // it, so this cannot even be typed — cast to prove it cannot reach SQL.
      ...({ operatorUserId: PEER, to: PEER } as unknown as object),
    } as never);
    const [, payload] = vi.mocked(pingRepo.insertPing).mock.calls[0];
    expect(payload.recipient_user_id).toBe(ME);
    expect(payload.recipient_kind).toBe("agent");
    expect(payload.recipient_agent_id).toBe(AGENT);
  });

  it("stamps ctx.userId as the RECIPIENT for toDesktop", async () => {
    await createPing(ctx, { ...BASE, toDesktop: true });
    const [, payload] = vi.mocked(pingRepo.insertPing).mock.calls[0];
    expect(payload.recipient_user_id).toBe(ME);
    expect(payload.recipient_kind).toBe("desktop");
    expect(payload.recipient_agent_id).toBeNull();
  });
});

describe("the member form is fenced like a post's addressee", () => {
  it("files a ping for a member of this channel", async () => {
    await createPing(ctx, { ...BASE, to: PEER });
    const [, payload] = vi.mocked(pingRepo.insertPing).mock.calls[0];
    expect(payload.recipient_kind).toBe("member");
    expect(payload.recipient_user_id).toBe(PEER);
  });

  it("refuses somebody who is not on this channel", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue(null as never);
    await expect(createPing(ctx, { ...BASE, to: PEER })).rejects.toThrow(
      /not a member of this channel/i
    );
    expect(pingRepo.insertPing).not.toHaveBeenCalled();
  });

  it("refuses somebody who left the workspace, even with a channel row", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(false as never);
    await expect(createPing(ctx, { ...BASE, to: PEER })).rejects.toThrow(
      /not a member of this channel/i
    );
  });

  it("collapses a malformed ref onto the SAME refusal, never a uuid= filter", async () => {
    // ⚠ Without the shape check this is a 22P02 plus a `system_events` row per
    // call, and a distinguishable answer makes ids probeable.
    await expect(
      createPing(ctx, { ...BASE, to: "not-a-uuid" })
    ).rejects.toThrow(/not a member of this channel/i);
    expect(repo.findMembership).not.toHaveBeenCalled();
  });

  it("refuses a self `to=` and names the instrument that works", async () => {
    await expect(createPing(ctx, { ...BASE, to: ME })).rejects.toThrow(
      /toDesktop/
    );
  });
});

describe("MEMBERSHIP, NOT READABILITY", () => {
  it("404s a PUBLIC channel the sender never joined", async () => {
    // `loadVisibleChannel` admits a non-member to a public channel; a ping may
    // only be sent by a member, so a public channel widens this by zero callers.
    vi.mocked(loadVisibleChannel).mockResolvedValue({
      channel: channelRow,
      membership: null,
    } as never);
    await expect(createPing(ctx, { ...BASE, toDesktop: true })).rejects.toThrow(
      /not found/i
    );
    expect(pingRepo.insertPing).not.toHaveBeenCalled();
  });

  it("404s a thread that is not in this channel", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null as never);
    await expect(
      createPing(ctx, { ...BASE, toDesktop: true, threadId: TASK })
    ).rejects.toThrow(/not found/i);
  });
});

describe("EXACTLY ONE RECIPIENT, enforced at the schema", () => {
  it("refuses zero and says so", () => {
    const parsed = PingCreateSchema.safeParse(BASE);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed)).toMatch(/exactly one recipient/i);
  });

  it("refuses two and NAMES THE COUNT IT SAW", () => {
    // ⚠ The count is in the message because a caller that sent two cannot
    // otherwise tell which one the server would have honoured.
    const parsed = PingCreateSchema.safeParse({
      ...BASE,
      to: PEER,
      toDesktop: true,
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed)).toMatch(/2 were given/);
  });

  it("accepts each of the three, one at a time", () => {
    for (const recipient of [
      { to: PEER },
      { toDesktop: true as const },
      { agentId: AGENT },
    ]) {
      expect(PingCreateSchema.safeParse({ ...BASE, ...recipient }).success).toBe(
        true
      );
    }
  });
});

describe("the body cap is the feature, not a safety margin", () => {
  it("accepts 600 characters and refuses 601", () => {
    const at = { ...BASE, toDesktop: true as const, body: "x".repeat(600) };
    expect(PingCreateSchema.safeParse(at).success).toBe(true);
    expect(
      PingCreateSchema.safeParse({ ...at, body: "x".repeat(601) }).success
    ).toBe(false);
  });
});

describe("🔒 the inbox read carries BOTH fences the RLS policy carries (R1)", () => {
  it("passes ctx.userId as the party fence and takes no recipient parameter", async () => {
    await listPings(ctx, { limit: 20, since: 4 });
    const call = vi.mocked(pingRepo.listPingsForRecipient).mock.calls[0];
    expect(call[0]).toBe(ME);
    expect(call[1]).toBe(WS);
    expect(call[3]).toEqual({ since: 4, limit: 20 });
  });

  it("narrows to the PROVEN channel set, so a removed member reads nothing", async () => {
    // ⚠ MUTATION CHECK. Drop the `.in("channel_id", …)` argument — pass
    // anything not derived from `listMemberChannelRefs` — and this fails: the
    // admin client bypasses RLS, so the proof IS the membership half of
    // `channel_pings_party_select`.
    await listPings(ctx, { limit: 20 });
    expect(vi.mocked(pingRepo.listPingsForRecipient).mock.calls[0][2]).toEqual([
      CH,
    ]);
  });

  it("hands the repository an EMPTY set when the caller is in no channel", async () => {
    vi.mocked(listMemberChannelRefs).mockResolvedValue([] as never);
    await listPings(ctx, { limit: 20 });
    expect(vi.mocked(pingRepo.listPingsForRecipient).mock.calls[0][2]).toEqual(
      []
    );
  });

  it("labels the page from the PROOF, paying no second channels read", async () => {
    const out = await listPings(ctx, { limit: 20 });
    expect(out[0].channelSlug).toBe("build");
  });

  it("renders channelSlug null when the proof carries no label for the row", async () => {
    vi.mocked(listMemberChannelRefs).mockResolvedValue([
      { id: "other", name: "Other", slug: "other" },
    ] as never);
    const out = await listPings(ctx, { limit: 20 });
    expect(out[0].channelSlug).toBeNull();
  });
});
