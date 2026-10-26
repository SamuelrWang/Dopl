/**
 * **CITATIONS, END TO END THROUGH THE REAL WRITE PATH** (grammar B, Samuel's
 * card #4401, 2026-10-12).
 *
 * ⚠ **EVERY CASE DRIVES `postMessage` → `resolvePostMetadata` AND READS THE
 * METADATA THAT CROSSED INTO `insertMessage`** (INVARIANTS §14). A regex over
 * `service-writes-metadata-cites.ts` would go red on a refactor that changed
 * nothing and green on a fold that was never wired into the write — and "was it
 * wired in" is the only interesting question about fold 12, because the resolver
 * is three branches and the wiring is where a citation feature dies quietly.
 *
 * ⚠ **TWO FAILURES ARE PINNED HERE AND THEY POINT OPPOSITE WAYS.** A citation
 * that cannot be resolved must REFUSE THE SEND — storing the prose and dropping
 * the reference leaves the author believing it landed. A citation the CALLER put
 * in `metadata` must be STRIPPED — it is the pointer a reader is aimed at, so a
 * settable copy is a forgery primitive one indirection past a settable mention
 * list. Refuse the honest mistake, discard the forgery.
 *
 * The harness mirrors `service-writes-metadata-mentions.test.ts`'s deliberately.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-threads");
// ⚠ The room's session projection, empty: RR3 reads it for every unaddressed
// human message, and a file that leaves it unstubbed reaches the real admin
// client and TIMES OUT rather than failing. This suite measures the metadata
// fold, not the wake.
vi.mock("./repository-sessions");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoThreads from "./repository-threads";
import * as repoSessions from "./repository-sessions";
import { postMessage } from "./service-writes";
import { CITES_METADATA_KEY, CITE_MODE_METADATA_KEY } from "../lib/cites";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ProfileRef,
} from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "user",
  role: "member",
};

/**
 * The two readable messages in THIS channel. ⚠ `seq` 12 is inside a thread and
 * 20 is not, because the thread claim is checked against the CITED row's own tag
 * and both outcomes need a fixture.
 */
const ROWS = [
  { id: "m-12", seq: 12, metadata: { threadId: "thread-chan-1-7" } },
  { id: "m-20", seq: 20, metadata: {} },
];

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "room",
    name: "Website",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-10-12T00:00:00Z",
    updated_at: "2026-10-12T00:00:00Z",
    ...overrides,
  };
}

function memberRow(userId: string, role = "member"): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role,
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-10-12T00:00:00Z",
  };
}

function profile(id: string, name: string, email: string): ProfileRef {
  return { id, display_name: name, email, avatar_url: null };
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-new",
    seq: 42,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-10-12T00:00:00Z",
  };
}

/** The metadata object handed to `repoMessages.insertMessage`. */
function capturedMetadata(): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
}

function has(meta: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
}

/** Did anything reach the table? The refusals are worthless if it did. */
function inserted(): boolean {
  return vi.mocked(repoMessages.insertMessage).mock.calls.length > 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    userId === USER ? memberRow(userId) : null
  );
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(repo.listMembers).mockResolvedValue([memberRow(USER, "owner")]);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([
    profile(USER, "Sam Wang", "sam@example.com"),
  ]);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
    rows: [],
    truncated: false,
  });
  // ⚠ **THE STUB ANSWERS LIKE THE FENCED QUERY, WHICH IS THE WHOLE POINT OF THE
  // CROSS-CHANNEL CASE BELOW.** The real finder is `eq("channel_id")` +
  // `in("seq")`, so a seq that exists in the table but in ANOTHER room comes back
  // as no row — indistinguishable here from a seq that exists nowhere, which is
  // exactly the behaviour being pinned. The `eq` itself is pinned at the query
  // level in `repository-messages-cite-refs.test.ts`; this half pins what the
  // service does with the empty answer.
  vi.mocked(repoMessages.findMessageRefsBySeqs).mockImplementation(
    async (channelId, seqs) =>
      channelId === "chan-1"
        ? ROWS.filter((r) => seqs.includes(r.seq))
        : []
  );
});

describe("postMessage — a resolved citation is stored as a MESSAGE ID", () => {
  it("stamps the id, the seq it came from, and the cited row's thread", async () => {
    await postMessage(ctx, "room", {
      body: "the fence is the eq, see the earlier note",
      cites: [{ seq: 12 }],
    });
    expect(capturedMetadata()[CITES_METADATA_KEY]).toEqual([
      { messageId: "m-12", seq: 12, no: null, thread: "thread-chan-1-7" },
    ]);
  });

  it("🔒 stores the ID, not the number — that is what removes the cutover", async () => {
    // ⚠ The invariant the whole grammar rests on: by the time a renderer sees a
    // citation it is a row id, so nothing downstream decides whether a digit
    // meant a per-channel number or a table-wide seq. If this ever stores the
    // bare number again, the ambiguity is back and the cutover date returns
    // with it.
    await postMessage(ctx, "room", { body: "see above", cites: [{ seq: 20 }] });
    const stored = capturedMetadata()[CITES_METADATA_KEY] as Array<
      Record<string, unknown>
    >;
    expect(stored[0].messageId).toBe("m-20");
    expect(typeof stored[0].messageId).toBe("string");
  });

  it("keeps the author's own order across several citations", async () => {
    await postMessage(ctx, "room", {
      body: "that one, then the other",
      cites: [{ seq: 20 }, { seq: 12 }],
    });
    expect(
      (capturedMetadata()[CITES_METADATA_KEY] as Array<{ messageId: string }>).map(
        (c) => c.messageId
      )
    ).toEqual(["m-20", "m-12"]);
  });

  it("a repeated citation is ONE entry and ONE lookup", async () => {
    // Naming the same message in two sentences is not an error; it is one row.
    await postMessage(ctx, "room", {
      body: "as noted, and again as noted",
      cites: [{ seq: 12 }, { seq: 12 }],
    });
    expect(capturedMetadata()[CITES_METADATA_KEY]).toHaveLength(1);
    const calls = vi.mocked(repoMessages.findMessageRefsBySeqs).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual([12]);
  });

  it("resolves against THIS channel — the fence is passed, not assumed", async () => {
    await postMessage(ctx, "room", { body: "x", cites: [{ seq: 12 }] });
    expect(
      vi.mocked(repoMessages.findMessageRefsBySeqs).mock.calls[0][0]
    ).toBe("chan-1");
  });

  it("a matching thread claim resolves", async () => {
    await postMessage(ctx, "room", {
      body: "in that exchange",
      cites: [{ seq: 12, thread: "thread-chan-1-7" }],
    });
    expect(capturedMetadata()[CITES_METADATA_KEY]).toHaveLength(1);
  });
});

describe("a citation that cannot be resolved REFUSES THE SEND", () => {
  it("🔒 refuses and NAMES THE ENTRY", async () => {
    // An agent is the only caller that can write this field, and "a citation is
    // bad" with twenty entries is not something it can act on.
    await expect(
      postMessage(ctx, "room", { body: "see #999", cites: [{ seq: 999 }] })
    ).rejects.toThrow(/seq=999/);
  });

  it("🔒 and NOTHING was written", async () => {
    await expect(
      postMessage(ctx, "room", { body: "see #999", cites: [{ seq: 999 }] })
    ).rejects.toThrow();
    expect(
      inserted(),
      `The refusal must precede the insert. A stored message whose citation was ` +
        `already known to be dead is worse than a rejected send.`
    ).toBe(false);
  });

  it("🔒 refuses a seq from ANOTHER CHANNEL — the cross-channel case", async () => {
    // ⚠ `seq` IS TABLE-WIDE, so 777 is a real row somewhere; it is just not in
    // this room. The fenced read returns nothing and the send is refused, which
    // is also why cross-channel citations are not a v1 feature: there is no
    // second membership proof to stand on.
    await expect(
      postMessage(ctx, "room", { body: "see that other room", cites: [{ seq: 777 }] })
    ).rejects.toThrow(/seq=777 names no message in this channel/);
    expect(inserted()).toBe(false);
  });

  it("🔒 refuses a THREAD CLAIM the cited row contradicts, naming the thread", async () => {
    // The caller said "this message, in that thread". If the row is somewhere
    // else, the caller's model of the transcript is wrong, and resolving it
    // anyway hands back a pill that contradicts the sentence around it.
    await expect(
      postMessage(ctx, "room", {
        body: "in the other exchange",
        cites: [{ seq: 12, thread: "thread-chan-1-99" }],
      })
    ).rejects.toThrow(/seq=12 in thread thread-chan-1-99/);
    expect(inserted()).toBe(false);
  });

  it("🔒 refuses a thread claim on a message in NO thread", async () => {
    await expect(
      postMessage(ctx, "room", {
        body: "x",
        cites: [{ seq: 20, thread: "thread-chan-1-7" }],
      })
    ).rejects.toThrow(/seq=20 in thread thread-chan-1-7/);
  });

  it("🔒 refuses `no` as UNAVAILABLE, never as a silent fallback to `seq`", async () => {
    // The two namespaces disagree by the gap between a channel's own count and
    // the table's, so `no=12` treated as `seq=12` would resolve to the wrong
    // message, in some other room, with a pill pointing confidently at it. The
    // column arrives with the held migration.
    await expect(
      postMessage(ctx, "room", { body: "see #12", cites: [{ no: 12 }] })
    ).rejects.toThrow(/not available yet/);
    expect(inserted()).toBe(false);
  });

  it("🔒 refuses the WHOLE post for one bad entry among good ones", async () => {
    // Partial resolution would publish a message citing two things when its
    // author named three.
    await expect(
      postMessage(ctx, "room", {
        body: "three references",
        cites: [{ seq: 12 }, { seq: 999 }, { seq: 20 }],
      })
    ).rejects.toThrow(/seq=999/);
    expect(inserted()).toBe(false);
  });
});

describe("the caller cannot supply either citation key", () => {
  it("🔒 a caller-supplied `cites` in metadata is STRIPPED", async () => {
    // The forgery: a pointer the server never checked the author could read,
    // aimed at a reader who has no way to tell.
    await postMessage(ctx, "room", {
      body: "trust me",
      metadata: { [CITES_METADATA_KEY]: [{ messageId: "m-secret", seq: 1 }] },
    });
    expect(
      has(capturedMetadata(), CITES_METADATA_KEY),
      `A settable \`cites\` lets a post aim a reader at a row the server never ` +
        `checked it could see.`
    ).toBe(false);
  });

  it("🔒 and it does not survive BESIDE a real resolution", async () => {
    // The half a strip-then-restamp gets wrong: the server's list replaces the
    // caller's, it does not merge with it.
    await postMessage(ctx, "room", {
      body: "trust me",
      metadata: { [CITES_METADATA_KEY]: [{ messageId: "m-secret", seq: 1 }] },
      cites: [{ seq: 12 }],
    });
    expect(capturedMetadata()[CITES_METADATA_KEY]).toEqual([
      { messageId: "m-12", seq: 12, no: null, thread: "thread-chan-1-7" },
    ]);
  });

  it("🔒 a caller-supplied `citeMode` is STRIPPED here too", async () => {
    // ⚠ Stripped at the fold AND written authoritatively at the funnel
    // (`repository-messages.ts › insertMessage`, pinned in
    // `repository-messages-cite-stamp.test.ts`). Both, deliberately: this is the
    // half that reads as a rule where a reader looks for it, and the insert is
    // the half that cannot be bypassed. `insertMessage` is mocked in this file,
    // so what is observable HERE is the strip.
    await postMessage(ctx, "room", {
      body: "a new message claiming to be old",
      metadata: { [CITE_MODE_METADATA_KEY]: 1 },
    });
    expect(has(capturedMetadata(), CITE_MODE_METADATA_KEY)).toBe(false);
  });
});

describe("absence is the common case and must stay absent", () => {
  it("no `cites` field stores no key", async () => {
    await postMessage(ctx, "room", { body: "an ordinary message" });
    expect(has(capturedMetadata(), CITES_METADATA_KEY)).toBe(false);
  });

  it("🔒 an EMPTY list stores no key — not an empty array", async () => {
    // ⚠ `citeMode` alone already says "written under grammar B, cited nothing",
    // which is the renderer's empty-allowlist state. An empty `cites` array
    // would be a second spelling of one state, and two spellings is how a
    // three-state render field rots into a two-and-a-half-state one.
    await postMessage(ctx, "room", { body: "nothing cited", cites: [] });
    expect(has(capturedMetadata(), CITES_METADATA_KEY)).toBe(false);
  });

  it("an uncited message costs NO read", async () => {
    await postMessage(ctx, "room", { body: "the overwhelming majority" });
    expect(vi.mocked(repoMessages.findMessageRefsBySeqs)).not.toHaveBeenCalled();
  });

  it("🔒 prose that LOOKS like a citation is not one", async () => {
    // The ruling itself (card #4401): post-cutover prose never pills. Typing
    // `#12` is typing, and the only thing that makes a pill is this field.
    await postMessage(ctx, "room", {
      body: "my #1 priority is the #12 regression, see #4228",
    });
    expect(has(capturedMetadata(), CITES_METADATA_KEY)).toBe(false);
  });
});
