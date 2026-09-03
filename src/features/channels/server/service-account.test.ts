/**
 * THE ACCOUNT-WIDE READS' FENCES AND THEIR THREE HONESTY RULES.
 *
 * ⚠ **`service-account.ts` CARRIED THE T20/T21/T22 MEMBERSHIP FENCE WITH ZERO
 * TESTS IN `src/` UNTIL 2026-09-02**, and `repository-account.ts` cited a
 * `repository-account.test.ts` that did not exist. Both are written now; the
 * reviewer's brief was fence + truncation + since/unread, and each case below is
 * a MUTATION CHECK — it fails on the specific revert named in its comment.
 *
 * The properties that fail quietly:
 *  - 🔒 **THE ID SET FROM `listAccountChannelRefs` IS THE ONLY THING ANY OTHER
 *    QUERY MAY BE HANDED.** Every downstream read takes `channelIds` and runs on
 *    the admin client, so a set built from anywhere else is a cross-tenancy read
 *    with no error anywhere.
 *  - 🔒 **B1's LOCK REACHES THE PROOF (R3).** `withUserAuth` is the only wrapper
 *    on these routes, so nothing upstream applies `ctx.apiKeyWorkspaceId`; if it
 *    stops reaching the proof, a container-locked credential reads every
 *    workspace its operator belongs to.
 *  - **A CLIP IS REPORTED, NEVER RENDERED AS AN ABSENCE** (§9). At the ceiling
 *    counts as clipped.
 *  - **`unread: null` IS "NOT ASKED", NEVER ZERO** — the §10 telemetry rule
 *    applied to a count.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-account");
vi.mock("./repository-workspace");

import * as accountRepo from "./repository-account";
import { fetchProfiles } from "./repository-workspace";
import { getAccountStatus, readAccountMessages } from "./service-account";
import type { SessionStateRow } from "./collab-dto";
import type { ChannelMessageRow } from "./dto";

const ME = "22222222-3333-4444-5555-666666666666";
const PEER = "77777777-8888-9999-aaaa-bbbbbbbbbbbb";
const WS_A = "11111111-2222-3333-4444-555555555555";
const WS_B = "99999999-8888-7777-6666-555555555555";
const CH_A = "33333333-4444-5555-6666-777777777777";
const CH_B = "44444444-5555-6666-7777-888888888888";

function ref(id: string, workspaceId: string, name: string) {
  return { id, workspaceId, name, slug: name.toLowerCase() };
}

function messageRow(
  seq: number,
  channelId: string,
  over: Partial<ChannelMessageRow> = {}
): ChannelMessageRow {
  return {
    id: `msg-${seq}`,
    seq,
    channel_id: channelId,
    workspace_id: WS_A,
    author_user_id: PEER,
    author_kind: "user",
    kind: "message",
    body: `body ${seq}`,
    metadata: {},
    client_msg_id: null,
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  } as ChannelMessageRow;
}

function sessionRow(channelId: string): SessionStateRow {
  return {
    id: `s-${channelId}`,
    channel_id: channelId,
    workspace_id: WS_A,
    user_id: ME,
    session_key: "k",
    task_id: null,
    name: "Worker",
    state: "working",
    channel_name: null,
    thread_title: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    detail: null,
    tool_label: null,
    model: null,
    context_used: null,
    context_window: null,
    tokens_spent: null,
    started_at: null,
    last_activity_at: null,
    turns: null,
    tokens_delta: null,
    stale: null,
    denied_calls: null,
    last_denied_tool: null,
    last_wake_seq: null,
    last_wake_at: null,
  } as SessionStateRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountRepo.listAccountChannelRefs).mockResolvedValue({
    rows: [ref(CH_A, WS_A, "Build"), ref(CH_B, WS_B, "Ops")],
    truncated: false,
  } as never);
  vi.mocked(accountRepo.listAccountSessionStates).mockResolvedValue([] as never);
  vi.mocked(accountRepo.presenceAnywhereForUser).mockResolvedValue(
    false as never
  );
  vi.mocked(accountRepo.lastSeqByChannel).mockResolvedValue(
    new Map() as never
  );
  vi.mocked(accountRepo.tallyAccountMessagesAfter).mockResolvedValue({
    rows: [],
    truncated: false,
  } as never);
  vi.mocked(accountRepo.listAddressedToMe).mockResolvedValue({
    rows: [],
    truncated: false,
  } as never);
  vi.mocked(accountRepo.listMyLatestSeqByChannel).mockResolvedValue(
    new Map() as never
  );
  vi.mocked(accountRepo.listAccountMessagesAfter).mockResolvedValue({
    rows: [],
    truncated: false,
  } as never);
  vi.mocked(fetchProfiles).mockResolvedValue([] as never);
});

describe("🔒 the membership proof is the only source of a channel id set", () => {
  it("hands every downstream read exactly the proven ids, in both views", async () => {
    // ⚠ MUTATION CHECK. Widen any of these to a set not derived from
    // `listAccountChannelRefs` and this fails — they all run on the admin
    // client, where the array IS the tenancy fence.
    await getAccountStatus(ME, { since: 3 });
    const proven = [CH_A, CH_B];
    expect(vi.mocked(accountRepo.listAccountSessionStates).mock.calls[0]).toEqual(
      [ME, proven]
    );
    expect(vi.mocked(accountRepo.lastSeqByChannel).mock.calls[0][0]).toEqual(
      proven
    );
    expect(
      vi.mocked(accountRepo.tallyAccountMessagesAfter).mock.calls[0][0]
    ).toEqual(proven);
    expect(vi.mocked(accountRepo.listAddressedToMe).mock.calls[0][0]).toEqual(
      proven
    );
  });

  it("asks the session read for the CALLER's rows, never a channel's", async () => {
    // The operator-only telemetry rides this projection; `user_id` is what
    // keeps a peer's session out of it.
    await getAccountStatus(ME, {});
    expect(vi.mocked(accountRepo.listAccountSessionStates).mock.calls[0][0]).toBe(
      ME
    );
  });

  it("does no further read at all when the caller is in no channel", async () => {
    vi.mocked(accountRepo.listAccountChannelRefs).mockResolvedValue({
      rows: [],
      truncated: false,
    } as never);
    const out = await getAccountStatus(ME, { since: 1 });
    expect(out.channels).toEqual([]);
    expect(accountRepo.lastSeqByChannel).not.toHaveBeenCalled();
    expect(accountRepo.tallyAccountMessagesAfter).not.toHaveBeenCalled();
  });

  it("still reads PRESENCE with no channels — 'we could not tell' is not 'offline'", async () => {
    vi.mocked(accountRepo.listAccountChannelRefs).mockResolvedValue({
      rows: [],
      truncated: false,
    } as never);
    await getAccountStatus(ME, {});
    expect(accountRepo.presenceAnywhereForUser).toHaveBeenCalled();
  });
});

describe("🔒 B1's credential lock reaches the proof (R3)", () => {
  it("forwards ctx.apiKeyWorkspaceId to the status proof", async () => {
    // ⚠ MUTATION CHECK. Drop the argument and a container-locked credential
    // reads names, telemetry and previews out of every workspace its operator
    // belongs to — `withUserAuth` applies no lock of its own.
    await getAccountStatus(ME, { lockedWorkspaceId: WS_A });
    expect(
      vi.mocked(accountRepo.listAccountChannelRefs).mock.calls[0][1]
    ).toBe(WS_A);
  });

  it("forwards it on the message page too", async () => {
    await readAccountMessages(ME, { since: 0, lockedWorkspaceId: WS_A });
    expect(
      vi.mocked(accountRepo.listAccountChannelRefs).mock.calls[0][1]
    ).toBe(WS_A);
  });

  it("passes undefined for an UNLOCKED credential, which is every tenancy", async () => {
    await getAccountStatus(ME, {});
    expect(
      vi.mocked(accountRepo.listAccountChannelRefs).mock.calls[0][1]
    ).toBeUndefined();
  });
});

describe("a clip is reported, never rendered as an absence (§9)", () => {
  it("carries the channel clip through to truncated.channels", async () => {
    vi.mocked(accountRepo.listAccountChannelRefs).mockResolvedValue({
      rows: [ref(CH_A, WS_A, "Build")],
      truncated: true,
    } as never);
    const out = await getAccountStatus(ME, { since: 1 });
    expect(out.truncated.channels).toBe(true);
  });

  it("carries the unread and waiting clips separately — three facts, three flags", async () => {
    vi.mocked(accountRepo.tallyAccountMessagesAfter).mockResolvedValue({
      rows: [],
      truncated: true,
    } as never);
    vi.mocked(accountRepo.listAddressedToMe).mockResolvedValue({
      rows: [],
      truncated: true,
    } as never);
    const out = await getAccountStatus(ME, { since: 1 });
    expect(out.truncated).toEqual({
      channels: false,
      unread: true,
      waiting: true,
    });
  });

  it("reports the channel clip on the SESSIONS view as well", async () => {
    vi.mocked(accountRepo.listAccountChannelRefs).mockResolvedValue({
      rows: [ref(CH_A, WS_A, "Build")],
      truncated: true,
    } as never);
    const out = await getAccountStatus(ME, { view: "sessions" });
    expect(out.truncated.channels).toBe(true);
  });

  it("reports a clipped message page", async () => {
    vi.mocked(accountRepo.listAccountMessagesAfter).mockResolvedValue({
      rows: [messageRow(9, CH_A)],
      truncated: true,
    } as never);
    const page = await readAccountMessages(ME, { since: 0 });
    expect(page.truncated).toBe(true);
  });
});

describe("`since` and `unread` — null is NOT ASKED, never zero", () => {
  it("returns unread: null on every row when no cursor was supplied", async () => {
    const out = await getAccountStatus(ME, {});
    // ⚠ MUTATION CHECK. `?? 0` anywhere on this path turns "I asked for no
    // cursor" into "there is nothing new", which is the one lie a check-in read
    // must not tell.
    expect(out.channels.map((c) => c.unread)).toEqual([null, null]);
    expect(out.since).toBeNull();
    expect(accountRepo.tallyAccountMessagesAfter).not.toHaveBeenCalled();
  });

  it("counts per channel from the tally rows, never a second query", async () => {
    vi.mocked(accountRepo.tallyAccountMessagesAfter).mockResolvedValue({
      rows: [
        { channel_id: CH_A, seq: 5 },
        { channel_id: CH_A, seq: 6 },
        { channel_id: CH_B, seq: 7 },
      ],
      truncated: false,
    } as never);
    const out = await getAccountStatus(ME, { since: 4 });
    const byId = new Map(out.channels.map((c) => [c.channelId, c.unread]));
    expect(byId.get(CH_A)).toBe(2);
    expect(byId.get(CH_B)).toBe(1);
    expect(out.since).toBe(4);
  });

  it("reports 0 — not null — for a room with a cursor and nothing past it", async () => {
    vi.mocked(accountRepo.tallyAccountMessagesAfter).mockResolvedValue({
      rows: [{ channel_id: CH_A, seq: 5 }],
      truncated: false,
    } as never);
    const out = await getAccountStatus(ME, { since: 4 });
    expect(
      out.channels.find((c) => c.channelId === CH_B)?.unread
    ).toBe(0);
  });

  it("excludes the caller's own posts from the tally — an echo is not news", async () => {
    await getAccountStatus(ME, { since: 4 });
    expect(
      vi.mocked(accountRepo.tallyAccountMessagesAfter).mock.calls[0][2]
    ).toBe(ME);
  });
});

describe("the SESSIONS view is a parameter, not a second route", () => {
  it("skips the cursor arithmetic entirely and still carries sessions", async () => {
    vi.mocked(accountRepo.listAccountSessionStates).mockResolvedValue([
      sessionRow(CH_A),
    ] as never);
    const out = await getAccountStatus(ME, { view: "sessions", since: 4 });
    expect(accountRepo.lastSeqByChannel).not.toHaveBeenCalled();
    expect(accountRepo.listAddressedToMe).not.toHaveBeenCalled();
    const row = out.channels.find((c) => c.channelId === CH_A);
    expect(row?.sessions).toHaveLength(1);
    // A bare row states no cursor facts rather than guessing at them.
    expect(row?.unread).toBeNull();
    expect(row?.lastSeq).toBeNull();
    // ⚠ The cursor is still ECHOED, so a caller can tell what it asked.
    expect(out.since).toBe(4);
  });
});

describe("'waiting on you' fails towards an EXTRA card, never a missed one", () => {
  it("drops an addressed message the caller has posted past", async () => {
    vi.mocked(accountRepo.listAddressedToMe).mockResolvedValue({
      rows: [messageRow(10, CH_A, { metadata: { to_user_id: ME } })],
      truncated: false,
    } as never);
    vi.mocked(accountRepo.listMyLatestSeqByChannel).mockResolvedValue(
      new Map([[CH_A, 11]]) as never
    );
    const out = await getAccountStatus(ME, { since: 1 });
    expect(out.channels.find((c) => c.channelId === CH_A)?.waiting).toEqual([]);
  });

  it("keeps it when the own-message scan found nothing later", async () => {
    vi.mocked(accountRepo.listAddressedToMe).mockResolvedValue({
      rows: [messageRow(10, CH_A, { metadata: { to_user_id: ME } })],
      truncated: false,
    } as never);
    const out = await getAccountStatus(ME, { since: 1 });
    const waiting = out.channels.find((c) => c.channelId === CH_A)?.waiting;
    expect(waiting?.map((w) => w.seq)).toEqual([10]);
  });

  it("bounds the own-message scan from BELOW by the lowest addressed seq", async () => {
    vi.mocked(accountRepo.listAddressedToMe).mockResolvedValue({
      rows: [
        messageRow(30, CH_A, { metadata: { to_user_id: ME } }),
        messageRow(12, CH_B, { metadata: { to_user_id: ME } }),
      ],
      truncated: false,
    } as never);
    await getAccountStatus(ME, { since: 1 });
    // Every row the scan can return is one that could change an answer.
    expect(
      vi.mocked(accountRepo.listMyLatestSeqByChannel).mock.calls[0][2]
    ).toBe(11);
  });

  it("orders each channel's items OLDEST first and flags an escalation", async () => {
    vi.mocked(accountRepo.listAddressedToMe).mockResolvedValue({
      // The repository answers NEWEST first; the service reverses per channel.
      rows: [
        messageRow(20, CH_A, { metadata: { to_user_id: ME } }),
        messageRow(10, CH_A, {
          metadata: { to_user_id: ME, escalation: { issue: "x" } },
        }),
      ],
      truncated: false,
    } as never);
    const out = await getAccountStatus(ME, { since: 1 });
    const waiting = out.channels.find((c) => c.channelId === CH_A)?.waiting;
    expect(waiting?.map((w) => w.seq)).toEqual([10, 20]);
    expect(waiting?.[0].isEscalation).toBe(true);
    expect(waiting?.[1].isEscalation).toBe(false);
  });

  it("truncates the preview in the SERVICE — an untruncated body never ships", async () => {
    vi.mocked(accountRepo.listAddressedToMe).mockResolvedValue({
      rows: [
        messageRow(10, CH_A, {
          metadata: { to_user_id: ME },
          body: "x".repeat(5_000),
        }),
      ],
      truncated: false,
    } as never);
    const out = await getAccountStatus(ME, { since: 1 });
    const preview = out.channels.find((c) => c.channelId === CH_A)?.waiting[0]
      .preview;
    expect(preview!.length).toBeLessThan(5_000);
  });
});

describe("the account-wide message page", () => {
  it("tags every row with the tenancy handle a caller passes as workspace=", async () => {
    vi.mocked(accountRepo.listAccountMessagesAfter).mockResolvedValue({
      rows: [messageRow(9, CH_B)],
      truncated: false,
    } as never);
    const page = await readAccountMessages(ME, { since: 0 });
    expect(page.messages[0].workspaceId).toBe(WS_B);
    expect(page.messages[0].channelName).toBe("Ops");
    expect(page.channelCount).toBe(2);
  });

  it("excludes the caller's own posts, and answers empty with no channels", async () => {
    await readAccountMessages(ME, { since: 0 });
    expect(
      vi.mocked(accountRepo.listAccountMessagesAfter).mock.calls[0][3]
    ).toBe(ME);
    vi.mocked(accountRepo.listAccountChannelRefs).mockResolvedValue({
      rows: [],
      truncated: false,
    } as never);
    const page = await readAccountMessages(ME, { since: 0 });
    expect(page).toEqual({ messages: [], channelCount: 0, truncated: false });
  });
});
