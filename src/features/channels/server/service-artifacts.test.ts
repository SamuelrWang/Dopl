/**
 * 🔒 **THE ARTIFACT RULES, PINNED** (design #1220, accepted wholesale #1222;
 * data + service layer built 2026-09-06) — the file that has to fail when one of
 * the four ratified rulings is quietly undone.
 *
 * ⚠ **THE TWO PURE FUNCTIONS ARE PINNED IN `service-artifacts-fold.test.ts`,
 * WITHOUT A DATABASE AND WITHOUT THIS FILE'S DOUBLES.** `readNamesMessages` and
 * `foldEntries` were built pure precisely so the addressing PIN and the fold
 * rule could be pinned by arithmetic rather than by a fixture room; they were
 * split off on 2026-09-06 (review pass 2) when this file stood at 614 lines
 * against the §1 cap of 500. THIS file holds what genuinely needs doubles: the
 * four write actions, their authority and their idempotency. Add a pure-rule
 * case to the sibling, not here.
 *
 * ⚠ **IT ASSERTS WHAT WAS ASKED OF THE REPOSITORY, NOT ONLY WHAT CAME BACK.**
 * A refusal that answers correctly AFTER writing a row is not a refusal, and a
 * convergent create that re-runs the fold statement is the "half the run is in
 * each" bug the idempotency key exists to prevent. Neither is visible in a
 * return value, so the authority and idempotency blocks assert that the write
 * functions were NOT CALLED — same discipline as `personal-reach.test.ts`,
 * which pins its query shapes for the same reason.
 *
 * ⚠ **BOTH DOUBLES COME FROM `service-shared.ts`, WHICH IS THE ARROW BEING
 * PINNED.** `hydrateMessages` moved down there when the fold was wired into
 * `readMessages`, so `service-reads` → `service-artifacts` is the only edge
 * between those two files. A future slice that imports the hydrator back out of
 * `service-reads` reintroduces the cycle, and this mock stops matching the
 * module the service actually loads.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ⚠ **`requireMemberChannel` IS THE REAL BODY OVER THE MOCKED READ** (2026-09-06,
// when the gate moved to `service-shared.ts` as one copy of nine). It is not a
// bare `vi.fn()`: every write test below drives its refusal through
// `seeChannel(null)` — the public-channel reader the write arm must turn away —
// and a stub that resolved would silently pass every one of those cases. So the
// double keeps ONE double, `loadVisibleChannel`, and the membership `if` runs
// for real on top of it, exactly as it does in production.
vi.mock("./service-shared", async () => {
  const { ChannelForbiddenError } = await import("./errors");
  const loadVisibleChannel = vi.fn();
  return {
    loadVisibleChannel,
    hydrateMessages: vi.fn(),
    requireMemberChannel: vi.fn(
      async (ctx: unknown, ref: string, action: string) => {
        const { channel, membership } = (await loadVisibleChannel(
          ctx as never,
          ref
        )) as { channel: unknown; membership: unknown };
        if (!membership) throw new ChannelForbiddenError(action);
        return { channel, membership };
      }
    ),
  };
});
vi.mock("./repository-artifacts", () => ({
  ARTIFACT_MEMBER_LIMIT: 200,
  insertArtifact: vi.fn(),
  findOwnArtifactByClientId: vi.fn(),
  findArtifactByChannelAndId: vi.fn(),
  listArtifactsByIds: vi.fn(),
  artifactSpans: vi.fn(),
  listMessagesByArtifact: vi.fn(),
  foldMessagesIntoArtifact: vi.fn(),
  unfoldMessage: vi.fn(),
  unfoldAllForArtifact: vi.fn(),
  markArtifactDissolved: vi.fn(),
}));

import * as repoArtifacts from "./repository-artifacts";
import { hydrateMessages, loadVisibleChannel } from "./service-shared";
import { ChannelForbiddenError } from "./errors";
import type { ChannelArtifactRow } from "./dto";
import type { ChannelMessage } from "../types";
import type { ChannelContext } from "./service-shared";
import {
  addToArtifact,
  createArtifact,
  dissolveArtifact,
  readArtifact,
  removeFromArtifact,
  ArtifactNotFoundError,
} from "./service-artifacts";

const CHANNEL = "44444444-4444-4444-8444-444444444444";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const ART = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ctx: ChannelContext = {
  workspaceId: WORKSPACE,
  userId: ME,
  source: "agent",
} as ChannelContext;

function artifactRow(over: Partial<ChannelArtifactRow> = {}): ChannelArtifactRow {
  return {
    id: ART,
    channel_id: CHANNEL,
    workspace_id: WORKSPACE,
    name: "Wrap-up",
    summary: "",
    created_by: ME,
    created_by_agent: null,
    dissolved_at: null,
    client_msg_id: null,
    created_at: "2026-09-06T00:00:00Z",
    ...over,
  };
}

function msg(seq: number, over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: `m-${seq}`,
    seq,
    channelId: CHANNEL,
    authorUserId: ME,
    authorKind: "user",
    kind: "message",
    body: `body ${seq}`,
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-09-06T00:00:00Z",
    authorName: null,
    authorAvatarUrl: null,
    artifactId: null,
    ...over,
  } as ChannelMessage;
}

/** The visibility gate's answer. `membership: null` = a non-member who can
 *  READ a public channel — the exact caller the write arm must refuse. */
function seeChannel(membership: unknown = { user_id: ME }) {
  vi.mocked(loadVisibleChannel).mockResolvedValue({
    channel: { id: CHANNEL, workspace_id: WORKSPACE },
    membership,
  } as unknown as Awaited<ReturnType<typeof loadVisibleChannel>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  seeChannel();
  vi.mocked(repoArtifacts.insertArtifact).mockResolvedValue(artifactRow());
  vi.mocked(repoArtifacts.findOwnArtifactByClientId).mockResolvedValue(null);
  vi.mocked(repoArtifacts.findArtifactByChannelAndId).mockResolvedValue(artifactRow());
  vi.mocked(repoArtifacts.foldMessagesIntoArtifact).mockResolvedValue([]);
  vi.mocked(repoArtifacts.unfoldMessage).mockResolvedValue([]);
  vi.mocked(repoArtifacts.unfoldAllForArtifact).mockResolvedValue([]);
  vi.mocked(repoArtifacts.markArtifactDissolved).mockResolvedValue(artifactRow());
  vi.mocked(repoArtifacts.listMessagesByArtifact).mockResolvedValue([]);
  vi.mocked(repoArtifacts.artifactSpans).mockResolvedValue(new Map());
  vi.mocked(hydrateMessages).mockResolvedValue([]);
});

/* ─────────────────────────── CREATE: IDEMPOTENCY ────────────────────────── */

describe("createArtifact — idempotent on clientMsgId", () => {
  it("converges on the caller's FIRST artifact and folds nothing more", async () => {
    const first = artifactRow({ client_msg_id: "k-1" });
    vi.mocked(repoArtifacts.findOwnArtifactByClientId).mockResolvedValue(first);
    // ⚠ NO `artifactSpans` DOUBLE: the retry path stopped reading spans on
    // 2026-09-06 (review pass 2 finding 4 — the round trip was used only as a
    // boolean, and `listMessagesByArtifact` already answers `[]` for an empty
    // card). Leaving the stale double here would have said the opposite.
    vi.mocked(repoArtifacts.listMessagesByArtifact).mockResolvedValue([
      { seq: 11 },
      { seq: 12 },
      { seq: 13 },
    ] as never);

    const result = await createArtifact(ctx, CHANNEL, {
      action: "create",
      name: "Wrap-up",
      summary: "",
      messages: [11, 12, 13, 99],
      clientMsgId: "k-1",
    });

    expect(result.artifact.id).toBe(ART);
    expect(result.folded).toEqual([11, 12, 13]);
    // 🔒 THE RETRY WROTE NOTHING. A second card, or a second fold that absorbed
    // seq 99 (which arrived after the first call), is the exact failure the key
    // exists to prevent — "and then half the run is in each".
    expect(repoArtifacts.insertArtifact).not.toHaveBeenCalled();
    expect(repoArtifacts.foldMessagesIntoArtifact).not.toHaveBeenCalled();
  });

  it("probes AUTHOR-SCOPED, matching the partial unique index", async () => {
    await createArtifact(ctx, CHANNEL, {
      action: "create",
      name: "Wrap-up",
      summary: "",
      messages: [11],
      clientMsgId: "k-1",
    });
    // ⚠ (channel, CREATOR, key). Channel-scoped, a member reusing another
    // member's key would be handed THEIR artifact; and the index is
    // (channel_id, client_msg_id, created_by), so a wider read turns the
    // convergence into a 23505 the caller sees as a 500. Change one, change both.
    expect(repoArtifacts.findOwnArtifactByClientId).toHaveBeenCalledWith(
      CHANNEL,
      ME,
      "k-1"
    );
  });

  it("does not probe at all when no key was given", async () => {
    await createArtifact(ctx, CHANNEL, {
      action: "create",
      name: "Wrap-up",
      summary: "",
      messages: [11],
    });
    expect(repoArtifacts.findOwnArtifactByClientId).not.toHaveBeenCalled();
    expect(repoArtifacts.insertArtifact).toHaveBeenCalled();
  });

  it("de-duplicates and sorts the requested seqs before folding", async () => {
    await createArtifact(ctx, CHANNEL, {
      action: "create",
      name: "Wrap-up",
      summary: "",
      messages: [13, 11, 13, 12],
    });
    expect(repoArtifacts.foldMessagesIntoArtifact).toHaveBeenCalledWith(
      CHANNEL,
      ART,
      [11, 12, 13]
    );
  });

  it("reports folding FEWER than requested rather than a bare count", async () => {
    // ⚠ Design §5. Seq 12 is already in another artifact, so the statement's
    // `artifact_id IS NULL` predicate skips it — ONE ARTIFACT PER MESSAGE
    // holding as a schema property, not as a check something could forget.
    vi.mocked(repoArtifacts.foldMessagesIntoArtifact).mockResolvedValue([11, 13]);
    const result = await createArtifact(ctx, CHANNEL, {
      action: "create",
      name: "Wrap-up",
      summary: "",
      messages: [11, 12, 13],
    });
    expect(result.requested).toEqual([11, 12, 13]);
    expect(result.folded).toEqual([11, 13]);
  });

  it("carries the agent instance id onto the row when an agent creates it", async () => {
    await createArtifact(
      ctx,
      CHANNEL,
      { action: "create", name: "Wrap-up", summary: "", messages: [11] },
      "agent-77"
    );
    expect(repoArtifacts.insertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ created_by: ME, created_by_agent: "agent-77" })
    );
  });
});

describe("addToArtifact — one artifact per message", () => {
  it("does not move a message that is already in another artifact", async () => {
    vi.mocked(repoArtifacts.foldMessagesIntoArtifact).mockResolvedValue([]);
    const result = await addToArtifact(ctx, CHANNEL, {
      action: "add",
      artifact: ART,
      message: 12,
    });
    // The caller is TOLD, rather than being left to assume it landed.
    expect(result.requested).toEqual([12]);
    expect(result.folded).toEqual([]);
  });

  it("refuses to change a DISSOLVED artifact — there is no re-open", async () => {
    vi.mocked(repoArtifacts.findArtifactByChannelAndId).mockResolvedValue(
      artifactRow({ dissolved_at: "2026-09-06T01:00:00Z" })
    );
    await expect(
      addToArtifact(ctx, CHANNEL, { action: "add", artifact: ART, message: 12 })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repoArtifacts.foldMessagesIntoArtifact).not.toHaveBeenCalled();
  });

  it("refuses an artifact id that does not resolve INSIDE this channel", async () => {
    vi.mocked(repoArtifacts.findArtifactByChannelAndId).mockResolvedValue(null);
    await expect(
      addToArtifact(ctx, CHANNEL, { action: "add", artifact: ART, message: 12 })
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});

/* ───────────────────────────── THE TWO REFUSALS ─────────────────────────── */

/**
 * 🔒 **WRITES REQUIRE MEMBERSHIP, READS REQUIRE VISIBILITY** — ratified. In a
 * PUBLIC channel a non-member can read the transcript; letting that reader fold
 * the room's history would be an outsider writing a view decision onto somebody
 * else's room, a stronger power than the reading it was derived from.
 */
describe("authority — the non-member write refusal", () => {
  it("refuses a create from a visible-but-non-member caller, writing nothing", async () => {
    seeChannel(null);
    await expect(
      createArtifact(ctx, CHANNEL, {
        action: "create",
        name: "Wrap-up",
        summary: "",
        messages: [11],
      })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repoArtifacts.insertArtifact).not.toHaveBeenCalled();
    expect(repoArtifacts.foldMessagesIntoArtifact).not.toHaveBeenCalled();
  });

  it("refuses add, remove and dissolve from the same caller", async () => {
    seeChannel(null);
    await expect(
      addToArtifact(ctx, CHANNEL, { action: "add", artifact: ART, message: 1 })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    await expect(
      removeFromArtifact(ctx, CHANNEL, { action: "remove", artifact: ART, message: 1 })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    await expect(
      dissolveArtifact(ctx, CHANNEL, { action: "dissolve", artifact: ART })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repoArtifacts.unfoldMessage).not.toHaveBeenCalled();
    expect(repoArtifacts.unfoldAllForArtifact).not.toHaveBeenCalled();
    expect(repoArtifacts.markArtifactDissolved).not.toHaveBeenCalled();
  });

  it("still lets a NON-MEMBER open a card in a channel it can read", async () => {
    // ⚠ The asymmetry is the ruling, so it is pinned from both sides: reads
    // require visibility only. A test that only proved the refusal would pass
    // just as well if someone tightened reads to membership too.
    seeChannel(null);
    vi.mocked(repoArtifacts.listMessagesByArtifact).mockResolvedValue([
      { seq: 11 },
    ] as never);
    vi.mocked(hydrateMessages).mockResolvedValue([msg(11)]);
    const result = await readArtifact(ctx, CHANNEL, ART);
    expect(result.artifact.id).toBe(ART);
    expect(result.messages.map((m) => m.seq)).toEqual([11]);
    expect(result.truncated).toBe(false);
  });

  it("says truncated at the ceiling — clipped must not render as exhausted", async () => {
    // INVARIANTS §9: at the ceiling is indistinguishable from over it.
    const rows = Array.from({ length: 200 }, (_, i) => ({ seq: i + 1 }));
    vi.mocked(repoArtifacts.listMessagesByArtifact).mockResolvedValue(rows as never);
    vi.mocked(hydrateMessages).mockResolvedValue(rows.map((r) => msg(r.seq)));
    const result = await readArtifact(ctx, CHANNEL, ART);
    expect(result.truncated).toBe(true);
  });
});

/**
 * 🔒 **DISSOLVE IS CREATOR-ONLY** — ratified, and narrow on purpose. Decision 1
 * rules the per-message un-box for the message's AUTHOR and the artifact's
 * CREATOR and says nothing about dissolve; reading the author's arm across would
 * let one member with one folded message un-box everybody else's. Widening this
 * is Samuel's word, not a refactor's.
 */
describe("authority — the non-creator dissolve refusal", () => {
  it("refuses a member who did not create the artifact, releasing nothing", async () => {
    vi.mocked(repoArtifacts.findArtifactByChannelAndId).mockResolvedValue(
      artifactRow({ created_by: OTHER })
    );
    await expect(
      dissolveArtifact(ctx, CHANNEL, { action: "dissolve", artifact: ART })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repoArtifacts.unfoldAllForArtifact).not.toHaveBeenCalled();
    expect(repoArtifacts.markArtifactDissolved).not.toHaveBeenCalled();
  });

  it("un-folds FIRST and retires SECOND, so a crash leaves nothing stranded", async () => {
    vi.mocked(repoArtifacts.unfoldAllForArtifact).mockResolvedValue([11, 12]);
    const result = await dissolveArtifact(ctx, CHANNEL, {
      action: "dissolve",
      artifact: ART,
    });
    expect(result.folded).toEqual([11, 12]);
    // ⚠ ORDER IS THE ASSERTION. Reversed, a crash between the two statements
    // leaves messages folded into a retired card that nothing can un-box,
    // because `loadWritableArtifact` refuses a dissolved target.
    const unfoldOrder = vi.mocked(repoArtifacts.unfoldAllForArtifact).mock
      .invocationCallOrder[0];
    const retireOrder = vi.mocked(repoArtifacts.markArtifactDissolved).mock
      .invocationCallOrder[0];
    expect(unfoldOrder).toBeLessThan(retireOrder);
  });

  it("answers with the row it already had when a second dissolve matches nothing", async () => {
    // Idempotent by predicate: the repository keeps the FIRST timestamp, so a
    // retry must not 500 on the null it gets back.
    vi.mocked(repoArtifacts.markArtifactDissolved).mockResolvedValue(null);
    const result = await dissolveArtifact(ctx, CHANNEL, {
      action: "dissolve",
      artifact: ART,
    });
    expect(result.artifact.id).toBe(ART);
  });
});

describe("removeFromArtifact — the asymmetric un-box", () => {
  it("lets the artifact's CREATOR un-box a message they did not write", async () => {
    vi.mocked(repoArtifacts.findArtifactByChannelAndId).mockResolvedValue(
      artifactRow({ created_by: ME })
    );
    vi.mocked(repoArtifacts.unfoldMessage).mockResolvedValue([12]);
    const result = await removeFromArtifact(ctx, CHANNEL, {
      action: "remove",
      artifact: ART,
      message: 12,
    });
    expect(result.folded).toEqual([12]);
    // ⚠ It did not need to read the message to answer — the creator arm is
    // decided off the artifact row alone.
    expect(repoArtifacts.listMessagesByArtifact).not.toHaveBeenCalled();
  });

  it("lets the message's AUTHOR un-box their own message from someone else's card", async () => {
    vi.mocked(repoArtifacts.findArtifactByChannelAndId).mockResolvedValue(
      artifactRow({ created_by: OTHER })
    );
    vi.mocked(repoArtifacts.listMessagesByArtifact).mockResolvedValue([
      { seq: 12, author_user_id: ME },
    ] as never);
    vi.mocked(repoArtifacts.unfoldMessage).mockResolvedValue([12]);
    const result = await removeFromArtifact(ctx, CHANNEL, {
      action: "remove",
      artifact: ART,
      message: 12,
    });
    expect(result.folded).toEqual([12]);
    // 🔒 This escape hatch is what makes "an agent may fold a peer's message"
    // acceptable at all. Removing it re-opens decision 1.
  });

  it("refuses a member who is neither creator nor author", async () => {
    vi.mocked(repoArtifacts.findArtifactByChannelAndId).mockResolvedValue(
      artifactRow({ created_by: OTHER })
    );
    vi.mocked(repoArtifacts.listMessagesByArtifact).mockResolvedValue([
      { seq: 12, author_user_id: OTHER },
    ] as never);
    await expect(
      removeFromArtifact(ctx, CHANNEL, { action: "remove", artifact: ART, message: 12 })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repoArtifacts.unfoldMessage).not.toHaveBeenCalled();
  });

  it("refuses when the named seq is not in the artifact at all", async () => {
    vi.mocked(repoArtifacts.findArtifactByChannelAndId).mockResolvedValue(
      artifactRow({ created_by: OTHER })
    );
    vi.mocked(repoArtifacts.listMessagesByArtifact).mockResolvedValue([
      { seq: 11, author_user_id: ME },
    ] as never);
    await expect(
      removeFromArtifact(ctx, CHANNEL, { action: "remove", artifact: ART, message: 12 })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
  });
});
