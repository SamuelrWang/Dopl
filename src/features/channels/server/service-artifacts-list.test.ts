/**
 * 🔒 **THE ARTIFACT BROWSE READ, PINNED** — `listChannelArtifacts`, the lane
 * Samuel's 2026-09-16 artifacts-view ruling opened where design #1220 §5 had ruled
 * a list "not offered".
 *
 * ⚠ **ITS OWN FILE, MIRRORING THE SOURCE SPLIT** (`service-artifacts-list.ts`).
 * `service-artifacts.ts` is at the §1 cap and holds the four WRITE actions, their
 * authority and their idempotency; the browse read has a different gate, a
 * different bound and a different reason to change, so both the module and its
 * pins live beside it rather than being squeezed in next door.
 *
 * ⚠ **IT ASSERTS WHAT WAS ASKED OF THE REPOSITORY, NOT ONLY WHAT CAME BACK** — the
 * sibling's discipline. A read that answered correctly while asking for the whole
 * room unbounded is the bug this ceiling exists to prevent, and that is invisible
 * in a return value.
 *
 * MUTATION-VERIFY: drop the `limit` argument and the ceiling case fails; measure
 * `truncated` after the empty-member filter and the clip case fails; swap
 * `loadVisibleChannel` for `requireMemberChannel` and the visibility case fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ⚠ THE SAME TWO DOUBLES THE SIBLING TAKES, AND FOR ITS REASONS — the membership
// `if` runs for real over the mocked visibility read, so a test that expected a
// refusal could not be passed by a stub that simply resolved.
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
  listArtifactsByChannel: vi.fn(),
  artifactSpans: vi.fn(),
  listMessagesByArtifact: vi.fn(),
  foldMessagesIntoArtifact: vi.fn(),
  unfoldMessage: vi.fn(),
  unfoldAllForArtifact: vi.fn(),
  markArtifactDissolved: vi.fn(),
}));

import * as repoArtifacts from "./repository-artifacts";
import { loadVisibleChannel } from "./service-shared";
import { CHANNEL_ARTIFACT_LIST_LIMIT } from "../constants";
import type { ChannelArtifactRow } from "./dto";
import type { ChannelContext } from "./service-shared";
import { listChannelArtifacts } from "./service-artifacts-list";

const CHANNEL = "44444444-4444-4444-8444-444444444444";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const ME = "11111111-1111-4111-8111-111111111111";
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
    created_at: "2026-09-16T00:00:00Z",
    ...over,
  };
}

/** The visibility gate's answer. `membership: null` = a non-member who can READ a
 *  public channel — the caller this read must SERVE and the writes must refuse. */
function seeChannel(membership: unknown = { user_id: ME }) {
  vi.mocked(loadVisibleChannel).mockResolvedValue({
    channel: { id: CHANNEL, workspace_id: WORKSPACE },
    membership,
  } as unknown as Awaited<ReturnType<typeof loadVisibleChannel>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  seeChannel();
  vi.mocked(repoArtifacts.listArtifactsByChannel).mockResolvedValue([artifactRow()]);
  vi.mocked(repoArtifacts.artifactSpans).mockResolvedValue(
    new Map([[ART, { count: 3, firstSeq: 11, lastSeq: 14 }]])
  );
});

describe("listChannelArtifacts — the shape", () => {
  it("carries the CHANNEL-WIDE count and span, from the one aggregate", async () => {
    const { artifacts } = await listChannelArtifacts(ctx, CHANNEL);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifact.id).toBe(ART);
    expect(artifacts[0].count).toBe(3);
    expect(artifacts[0].firstSeq).toBe(11);
    expect(artifacts[0].lastSeq).toBe(14);
  });

  /** ⚠ THE REPOSITORY'S ORDER IS RENDERED VERBATIM — newest first, and the list is
   *  CLIPPED against that order, so a re-sort here is the wrong rows in a
   *  plausible one (the rule `threads-tab.tsx` keeps on its own list). */
  it("does not re-sort what the repository returned", async () => {
    const older = artifactRow({ id: "b", created_at: "2026-09-01T00:00:00Z" });
    vi.mocked(repoArtifacts.listArtifactsByChannel).mockResolvedValue([
      artifactRow(),
      older,
    ]);
    vi.mocked(repoArtifacts.artifactSpans).mockResolvedValue(
      new Map([
        [ART, { count: 3, firstSeq: 11, lastSeq: 14 }],
        ["b", { count: 1, firstSeq: 2, lastSeq: 2 }],
      ])
    );
    const { artifacts } = await listChannelArtifacts(ctx, CHANNEL);
    expect(artifacts.map((a) => a.artifact.id)).toEqual([ART, "b"]);
  });

  /** 🔒 A CARD THAT FOLDED NOTHING STANDS IN FOR NOTHING — the judgment call the
   *  service names. The honest alternative was printing `#0–#0`, seqs that do not
   *  exist. Reversing it is one branch, and this case is where it shows. */
  it("omits an artifact with no members rather than inventing its seqs", async () => {
    vi.mocked(repoArtifacts.listArtifactsByChannel).mockResolvedValue([
      artifactRow(),
      artifactRow({ id: "empty" }),
    ]);
    const { artifacts } = await listChannelArtifacts(ctx, CHANNEL);
    expect(artifacts.map((a) => a.artifact.id)).toEqual([ART]);
  });
});

describe("listChannelArtifacts — the bound", () => {
  it("asks the repository for the ceiling, never for the whole room", async () => {
    await listChannelArtifacts(ctx, CHANNEL);
    expect(repoArtifacts.listArtifactsByChannel).toHaveBeenCalledWith(
      CHANNEL,
      CHANNEL_ARTIFACT_LIST_LIMIT
    );
  });

  it("is not truncated below the ceiling", async () => {
    const { truncated } = await listChannelArtifacts(ctx, CHANNEL);
    expect(truncated).toBe(false);
  });

  /** ⚠ AT the ceiling counts as CLIPPED (INVARIANTS §9): a full page and an
   *  exhausted one are indistinguishable from here. */
  it("is truncated AT the ceiling, measured on the rows READ", async () => {
    const rows = Array.from({ length: CHANNEL_ARTIFACT_LIST_LIMIT }, (_, i) =>
      artifactRow({ id: `a-${i}` })
    );
    vi.mocked(repoArtifacts.listArtifactsByChannel).mockResolvedValue(rows);
    // ⚠ NO SPANS AT ALL — every row drops out of the answer, and the clip must
    // still be reported: the ceiling is what the database applied, not what
    // survived the filter above it.
    vi.mocked(repoArtifacts.artifactSpans).mockResolvedValue(new Map());
    const { artifacts, truncated } = await listChannelArtifacts(ctx, CHANNEL);
    expect(artifacts).toHaveLength(0);
    expect(truncated).toBe(true);
  });
});

describe("listChannelArtifacts — the gate", () => {
  /** 🔒 VISIBILITY, NOT MEMBERSHIP — the rule `readArtifact` takes, restated for
   *  the list because it is the same question: a reader who can already read the
   *  transcript learns nothing here they could not have scrolled to. */
  it("serves a non-member who can READ the channel", async () => {
    seeChannel(null);
    const { artifacts } = await listChannelArtifacts(ctx, CHANNEL);
    expect(artifacts).toHaveLength(1);
    expect(loadVisibleChannel).toHaveBeenCalledWith(ctx, CHANNEL);
  });

  /** ⚠ A READ THAT WROTE IS NOT A READ. Asserted on the repository, because a
   *  return value cannot show it. */
  it("writes nothing", async () => {
    await listChannelArtifacts(ctx, CHANNEL);
    expect(repoArtifacts.insertArtifact).not.toHaveBeenCalled();
    expect(repoArtifacts.foldMessagesIntoArtifact).not.toHaveBeenCalled();
    expect(repoArtifacts.unfoldMessage).not.toHaveBeenCalled();
    expect(repoArtifacts.unfoldAllForArtifact).not.toHaveBeenCalled();
    expect(repoArtifacts.markArtifactDissolved).not.toHaveBeenCalled();
  });

  /** ⚠ THE PAGE-PRICED READ IS NOT THIS ONE. `listArtifactsByIds` is bounded by
   *  the ids a transcript page saw; reaching for it here with `[]` would buy the
   *  whole room at the wrong price. */
  it("does not reach for the by-ids read", async () => {
    await listChannelArtifacts(ctx, CHANNEL);
    expect(repoArtifacts.listArtifactsByIds).not.toHaveBeenCalled();
  });
});
