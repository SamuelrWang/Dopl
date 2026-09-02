/**
 * IDEMPOTENCY IS A SAME-AUTHOR RETRY CONTRACT (2026-08-22). One rule, pinned at
 * the three layers that have to agree about it or it is not enforced anywhere.
 *
 * ── THE VULNERABILITY ────────────────────────────────────────────────────────
 * `postMessage`'s short-circuit read was `(channel.id, key)` —
 * scoped to the CHANNEL — so "I already sent this, give me back what you stored"
 * was a contract with the whole ROOM. The keys are neither secret nor random on
 * the caller that sets them at scale: the desktop stamps `agent-<agentId>-<n>`
 * (`dopl-desktop-app/main/session-outbound-tag.js › nextOwnPostId`), `agentId` is
 * published to every workspace member as `channel_sessions.name`, and `n` counts
 * from 1. So any channel member could post messages carrying another operator's
 * agent's NEXT few keys; that agent's real post then found the pre-claimed row,
 * wrote nothing, and returned `{ok}` with the attacker's message id. The peer
 * waiting on the thread got silence, and no error was raised on either side.
 *
 * ── WHY THIS FILE ASSERTS THE MIGRATION TOO ──────────────────────────────────
 * Author-scoping only the READ moves the failure rather than fixing it: the probe
 * misses, the INSERT hits a still channel-scoped unique index, and the race
 * repair — also author-scoped — finds nothing and rethrows a `23505` the caller
 * sees as a 500. The service tests below run against a MOCKED repository and
 * would be perfectly green over exactly that. Asserting the index is what stops
 * this suite being "green about a payload the other side of the boundary
 * refuses" — the same trap `_session-state-push-harness.mjs` records.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import { supabaseAdmin } from "@/shared/supabase/admin";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow } from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const ME = "aaaaaaaa-e29b-41d4-a716-446655440000";
const ATTACKER = "bbbbbbbb-e29b-41d4-a716-446655440000";
const KEY = "agent-a1b2c3d4-5"; // the desktop's stamp, exactly as it ships

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  source: "agent",
  role: "member",
};

// ── LAYER 1: the query shape that actually reaches PostgREST ────────────────
//
// ⚠ THE FILTER STRING IS THE ONLY PLACE THIS IS VISIBLE. A service test over a
// mocked repository cannot see whether the repository function narrows by author
// at all — it only sees which function was called.

type Call = { op: string; args: unknown[] };

function makeAdmin(row: ChannelMessageRow | null) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    select: (c: string) => rec("select", [c]),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    maybeSingle: () => {
      calls.push({ op: "maybeSingle", args: [] });
      return Promise.resolve({ data: row, error: null });
    },
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

function eqFilters(calls: Call[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of calls) if (c.op === "eq") out[String(c.args[0])] = c.args[1];
  return out;
}

describe("the two (channel, client_msg_id) reads are scoped differently", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("the IDEMPOTENCY probe narrows by channel, key AND author", async () => {
    const real = await vi.importActual<typeof repoMessages>("./repository-messages");
    const calls = makeAdmin(null);

    await real.findOwnMessageByClientId("chan-1", ME, KEY);

    expect(eqFilters(calls)).toEqual({
      channel_id: "chan-1",
      client_msg_id: KEY,
      author_user_id: ME,
    });
  });

  it("and it is the ONLY (channel, client_msg_id) read left on this module", () => {
    // ⚠ THE CROSS-AUTHOR SIBLING IS DELETED (2026-09-02). It existed for
    // `service-tasks.ts › storedOpeningSeq`, the arm a create took when it
    // converged on somebody else's thread; author-scoping the THREAD probe too
    // removed that arm, and an orphan repository helper reads as a live door.
    expect("findMessageByClientId" in repoMessages).toBe(false);
  });
});

// ── LAYER 2: what postMessage does with those reads ─────────────────────────

function channelRow(): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: ME,
    slug: "general",
    name: "General",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z",
  };
}

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: ME,
    joined_at: "2026-08-20T00:00:00Z",
  };
}

function storedRow(over: Partial<ChannelMessageRow> = {}): ChannelMessageRow {
  return {
    id: "msg-stored",
    seq: 41,
    channel_id: "chan-1",
    workspace_id: WS,
    author_user_id: ME,
    author_kind: "agent",
    kind: "message",
    body: "the answer",
    metadata: {},
    client_msg_id: KEY,
    created_at: "2026-08-22T00:00:00Z",
    ...over,
  };
}

describe("postMessage's short-circuit belongs to the author, not the room", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) => memberRow(uid));
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
    vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
    vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue(null);
    vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
      storedRow({
        id: "msg-fresh",
        seq: 42,
        author_user_id: row.author_user_id,
        author_kind: row.author_kind,
        body: row.body,
        metadata: row.metadata,
        client_msg_id: row.client_msg_id,
      })
    );
  });

  it("THE ATTACK: another member's row on the same key does NOT swallow my post", async () => {
    const { postMessage } = await import("./service-writes");
    // The attacker pre-claimed the key: a row exists in this channel under it,
    // authored by someone else. A CHANNEL-scoped probe would find it; the
    // author-scoped one cannot, so it answers null for THIS author.
    vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue(null);

    const out = await postMessage(ctx, "general", { body: "the answer", clientMsgId: KEY });

    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("msg-fresh");
    expect(out.id).not.toBe("msg-preclaimed");
    // …and the probe that ran was the author-scoped one, with THIS author.
    expect(repoMessages.findOwnMessageByClientId).toHaveBeenCalledWith("chan-1", ME, KEY);
  });

  it("two authors, one key, one channel → TWO distinct messages", async () => {
    const { postMessage } = await import("./service-writes");
    const mine = await postMessage(ctx, "general", { body: "mine", clientMsgId: KEY });
    const theirs = await postMessage(
      { ...ctx, userId: ATTACKER },
      "general",
      { body: "theirs", clientMsgId: KEY }
    );
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(2);
    expect(mine.authorUserId).toBe(ME);
    expect(theirs.authorUserId).toBe(ATTACKER);
  });

  it("MY OWN retry is still idempotent — one row, no second write", async () => {
    const { postMessage } = await import("./service-writes");
    vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue(storedRow());

    const out = await postMessage(ctx, "general", { body: "the answer", clientMsgId: KEY });

    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    expect(out.id).toBe("msg-stored");
    expect(out.seq).toBe(41);
  });

  it("the LOST-RACE repair answers on the same scope, or rethrows", async () => {
    const { postMessage } = await import("./service-writes");
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");
    vi.mocked(repoMessages.insertMessage).mockRejectedValue({ code: "23505" });
    // My own concurrent retry won: the author-scoped repair finds it.
    vi.mocked(repoMessages.findOwnMessageByClientId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedRow());
    await expect(
      postMessage(ctx, "general", { body: "the answer", clientMsgId: KEY })
    ).resolves.toMatchObject({ id: "msg-stored" });

    // ⚠ AND IT DOES NOT REACH FOR A WIDER READ TO AVOID THROWING. A `23505` this
    // author cannot account for is a real error; answering it with somebody
    // else's row is the swallow, wearing a different hat.
    vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue(null);
    await expect(
      postMessage(ctx, "general", { body: "the answer", clientMsgId: KEY })
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("a post with NO client_msg_id probes nothing at all (unchanged)", async () => {
    const { postMessage } = await import("./service-writes");
    await postMessage(ctx, "general", { body: "no key" });
    expect(repoMessages.findOwnMessageByClientId).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });
});

// ── LAYER 3: the database agrees, or none of the above is enforced ──────────

describe("the unique index states the same rule as the query", () => {
  const sql = readdirSync(join(process.cwd(), "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(process.cwd(), "supabase", "migrations", f), "utf8"))
    .join("\n");

  it("channel_messages' idempotency index carries the author, and the pair index is dropped", () => {
    const created = [
      ...sql.matchAll(
        /CREATE UNIQUE INDEX (?:IF NOT EXISTS )?(\w+)\s+ON (?:public\.)?channel_messages\s*\(([^()]*)\)/g
      ),
    ].map((m) => ({ name: m[1], cols: m[2].split(",").map((c) => c.trim()) }));

    const triple = created.find((i) => i.name === "channel_messages_client_msg_author_key");
    expect(triple, "20260822120000 no longer creates the author-scoped index").toBeTruthy();
    // ⚠ COLUMN ORDER IS LOAD-BEARING: the leading `(channel_id, client_msg_id)`
    // pair is what keeps the CROSS-AUTHOR read above index-served.
    expect(triple?.cols).toEqual(["channel_id", "client_msg_id", "author_user_id"]);

    // The channel-scoped one must be GONE, not merely joined by a wider sibling —
    // it is the constraint that turns a foreign pre-claim into a 23505.
    expect(sql).toMatch(/DROP INDEX IF EXISTS public\.channel_messages_client_msg_key;/);
  });
});
