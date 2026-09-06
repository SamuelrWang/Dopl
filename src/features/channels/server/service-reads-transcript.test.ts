/**
 * `readTranscript` — THE ENVELOPE'S OWN RULE, at the service level (artifacts
 * #1220 §4, A4 last wire 2026-09-06).
 *
 * ⚠ **ITS OWN FILE, NOT A BLOCK IN `service-reads.test.ts`.** That file is ~450
 * lines against the hard 500 cap (INVARIANTS §1) and this suite moves when the
 * ARTIFACT product moves, not when a read projection does — the same split
 * `view-model-artifacts.ts` makes on the client side.
 *
 * ⚠ **WHAT IS ALREADY COVERED ELSEWHERE, AND IS NOT RE-ASSERTED HERE.**
 * `service-artifacts.test.ts` drives `foldEntries` and `readNamesMessages` as
 * PURE functions, exhaustively. This suite asks the one question those cannot:
 * **does `readTranscript` turn a folded page into `entries` and an ordinary page
 * into `null`** — the `folded ? entries : null` line, which is the whole
 * difference between the wire carrying a card and the wire carrying nothing.
 * A page-level rule proven twice at the same level is not two proofs.
 *
 * Repositories mocked; `service-shared`, `service-reads` and `service-artifacts`
 * all run FOR REAL, so importing this file is itself a standing check that the
 * `service-reads → service-artifacts → service-shared` arrows still resolve one
 * way (the cycle fix `service-artifacts.ts` documents at both ends).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-collab");
vi.mock("./repository-tasks");
vi.mock("./repository-artifacts");
vi.mock("@/features/workspaces/server/repository");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoArtifacts from "./repository-artifacts";
import * as collab from "./repository-collab";
import * as workspaceRepo from "@/features/workspaces/server/repository";
import { readTranscript } from "./service-reads";
import type { ChannelContext } from "./service-shared";
import type {
  ChannelArtifactRow,
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
} from "./dto";

const WS = "ws-1";
const USER = "user-1";
const CHANNEL = "chan-1";
const ART = "art-1";
/** A first-class thread id, as the read scope receives it. */
const THREAD = "660e8400-e29b-41d4-a716-446655440111";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "user",
  role: "member",
};

function channelRow(): ChannelRow {
  return {
    id: CHANNEL,
    workspace_id: WS,
    created_by: USER,
    slug: "general",
    name: "General",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

function memberRow(): ChannelMemberRow {
  return {
    channel_id: CHANNEL,
    user_id: USER,
    workspace_id: WS,
    role: "owner",
    // ⚠ AT THE NEWEST ROW, so the watermark never writes. This suite is about
    // the envelope; a `updateLastRead` call here would be noise from a loop
    // guard that has its own tests next door.
    last_read_at: "2099-01-01T00:00:00.000Z",
    notify_scope: "none",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-09-01T00:00:00Z",
  };
}

function messageRow(
  seq: number,
  artifactId: string | null = null
): ChannelMessageRow {
  return {
    id: `msg-${seq}`,
    seq,
    channel_id: CHANNEL,
    workspace_id: WS,
    author_user_id: USER,
    author_kind: "user",
    kind: "message",
    body: `body ${seq}`,
    metadata: {},
    client_msg_id: null,
    created_at: "2026-09-05T10:00:00.000Z",
    artifact_id: artifactId,
  };
}

function artifactRow(): ChannelArtifactRow {
  return {
    id: ART,
    channel_id: CHANNEL,
    workspace_id: WS,
    name: "Gate run",
    summary: "the terminal output",
    created_by: USER,
    created_by_agent: null,
    dissolved_at: null,
    client_msg_id: null,
    created_at: "2026-09-05T09:00:00.000Z",
  };
}

/** The artifact is REAL: two members on this page, seven channel-wide. */
function artifactIsLoadable() {
  vi.mocked(repoArtifacts.listArtifactsByIds).mockResolvedValue([artifactRow()]);
  vi.mocked(repoArtifacts.artifactSpans).mockResolvedValue(
    new Map([[ART, { count: 7, firstSeq: 900, lastSeq: 1200 }]])
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow());
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map());
  vi.mocked(workspaceRepo.listMemberRolesByUserIds).mockResolvedValue(new Map());
  // ⚠ AUTOMOCK DEFAULTS RETURN `undefined`, which `foldPage` would read as a
  // crash rather than as "no artifacts". Every case that wants a fold overrides
  // these; leaving them EMPTY here is what makes "no fold" the default state.
  vi.mocked(repoArtifacts.listArtifactsByIds).mockResolvedValue([]);
  vi.mocked(repoArtifacts.artifactSpans).mockResolvedValue(new Map());
});

describe("readTranscript — `entries` is null unless the page actually folded", () => {
  it("returns entries: null on an ordinary page, and pays NOTHING for the feature", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(10),
      messageRow(11),
    ]);

    const { messages, entries } = await readTranscript(ctx, "general", {
      limit: 50,
    });

    // ⚠ `null` MEANS "nothing here is in an artifact", never "this server
    // cannot fold" — the one distinction the shape has to make.
    expect(entries).toBeNull();
    // ⚠ AND THE PAGE IS STILL WHOLE. A null envelope that also shortened
    // `messages` would be the read path losing rows, which is the failure the
    // additive design exists to prevent.
    expect(messages.map((m) => m.seq)).toEqual([10, 11]);
    // THE COST CLAIM, ASSERTED RATHER THAN COMMENTED (`readTranscript`'s docblock:
    // "an ordinary transcript pays nothing"). `foldPage` short-circuits before
    // both reads when no row carries an `artifact_id`.
    expect(repoArtifacts.listArtifactsByIds).not.toHaveBeenCalled();
    expect(repoArtifacts.artifactSpans).not.toHaveBeenCalled();
  });

  it("returns entries when a row IS folded, with `messages` still complete", async () => {
    artifactIsLoadable();
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(10),
      messageRow(11, ART),
      messageRow(12, ART),
      messageRow(13),
    ]);

    const { messages, entries } = await readTranscript(ctx, "general", {
      limit: 50,
    });

    // ⚠ **BOTH HALVES RIDE**, which is the additive envelope: an
    // artifact-unaware client renders the four messages exactly as yesterday.
    expect(messages.map((m) => m.seq)).toEqual([10, 11, 12, 13]);
    expect(entries).not.toBeNull();
    // ONE card for TWO members, at the position of the lower one.
    expect(entries!.map((e) => e.type)).toEqual([
      "message",
      "artifact",
      "message",
    ]);
    const card = entries!.find((e) => e.type === "artifact");
    expect(card).toBeDefined();
    if (card?.type !== "artifact") throw new Error("unreachable");
    // ⚠ **THE AGGREGATE IS THE WHOLE ARTIFACT, NEVER THE PAGE** — two members
    // are here and the card must still say seven. A count taken off the page
    // would answer a different question every time the page moved, which is the
    // reason `artifactSpans` exists instead of arithmetic over rows in hand.
    expect(card.folded.count).toBe(7);
    expect(card.folded.firstSeq).toBe(900);
    expect(card.folded.lastSeq).toBe(1200);
    expect(card.folded.artifact.name).toBe("Gate run");
    // The two reads are bounded by the page's DISTINCT artifact ids — one id
    // for two members, not one lookup per row.
    expect(repoArtifacts.listArtifactsByIds).toHaveBeenCalledWith(CHANNEL, [ART]);
    expect(repoArtifacts.artifactSpans).toHaveBeenCalledWith(CHANNEL, [ART]);
  });

  it("degrades a member whose artifact could not be loaded to a MESSAGE, and so to entries: null", async () => {
    // The span is there, the card row is not (a dissolved-and-swept artifact, a
    // read that failed its half). ⚠ Missing facts must degrade to "unfolded",
    // NEVER to "dropped": a transcript that silently loses a row because a card
    // lookup failed is data loss on a read path.
    vi.mocked(repoArtifacts.listArtifactsByIds).mockResolvedValue([]);
    vi.mocked(repoArtifacts.artifactSpans).mockResolvedValue(
      new Map([[ART, { count: 7, firstSeq: 900, lastSeq: 1200 }]])
    );
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(10),
      messageRow(11, ART),
    ]);

    const { messages, entries } = await readTranscript(ctx, "general", {
      limit: 50,
    });

    expect(messages.map((m) => m.seq)).toEqual([10, 11]);
    // ⚠ **NULL, NOT AN ALL-MESSAGE ARRAY.** Nothing folded, so the wire says
    // nothing folded — a renderer that received entries here would rebuild its
    // rows through the artifact path to draw exactly the same thing, and the
    // route would spend the bytes to describe a feature the page does not use.
    expect(entries).toBeNull();
  });
});

describe("readTranscript — a read that NAMES messages never folds", () => {
  it("does not fold a THREAD read, and does not even ask", async () => {
    artifactIsLoadable();
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(11, ART),
      messageRow(12, ART),
    ]);

    const { messages, entries } = await readTranscript(ctx, "general", {
      limit: 50,
      thread: THREAD,
    });

    // ⚠ A THREAD QUERY IS A NAMED SUBSET (#1220 §3), so the members come back as
    // MEMBERS even though both are folded channel-wide. Somebody holding a
    // citation must get the message, not the box it went into.
    expect(entries).toBeNull();
    expect(messages.map((m) => m.seq)).toEqual([11, 12]);
    // ⚠ **AND THE REFUSAL IS UPSTREAM OF THE READS**, not a filter after them —
    // `readNamesMessages` returns before `foldPage` touches the repository. A
    // version that folded and then discarded would pass every assertion above
    // and cost two queries per thread page.
    expect(repoArtifacts.listArtifactsByIds).not.toHaveBeenCalled();
    expect(repoArtifacts.artifactSpans).not.toHaveBeenCalled();
  });

  it("does not fold a bounded `since` + `before` window", async () => {
    artifactIsLoadable();
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(11, ART),
    ]);

    const { entries } = await readTranscript(ctx, "general", {
      limit: 50,
      since: 10,
      before: 20,
    });

    // The pair IS "the range containing that message" — the second half of the
    // addressing pin.
    expect(entries).toBeNull();
    expect(repoArtifacts.listArtifactsByIds).not.toHaveBeenCalled();
  });

  it("DOES fold a lone `since` — the incremental read is the default read", async () => {
    artifactIsLoadable();
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(11, ART),
    ]);

    const { entries } = await readTranscript(ctx, "general", {
      limit: 50,
      since: 10,
    });

    // ⚠ **THE RULING, PINNED AT THIS LEVEL TOO** (ratified 2026-09-06): a lone
    // `since` is NOT a range naming a message. Treating it as one would mean
    // nothing ever folds, because a cursor read is what every agent on the wire
    // does — the feature would be dead on the surface that needs it most.
    expect(entries).not.toBeNull();
    expect(entries!.map((e) => e.type)).toEqual(["artifact"]);
  });

  it("DOES fold a lone `before` — a back-page still shows its cards", async () => {
    artifactIsLoadable();
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(11, ART),
    ]);

    const { entries } = await readTranscript(ctx, "general", {
      limit: 50,
      before: 20,
    });

    // ⚠ THE SYMMETRIC HALF, and it is the one the client wire cares about: the
    // transcript's scroll-back cursor is a lone `before`, so a rule that folded
    // only the newest page would hand history a different shape than the page
    // above it.
    expect(entries).not.toBeNull();
    expect(entries!.map((e) => e.type)).toEqual(["artifact"]);
  });
});
