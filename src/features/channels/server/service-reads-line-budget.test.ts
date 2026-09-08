/**
 * **`readTranscript`'S LINE-BUDGETED PAGE** (2026-09-08, Samuel: *"chunks
 * shouldnt be by messages. Because a message can be like 20 lines or it can be
 * 2 lines. So we should chunk by lines instead … lets do 300 as the line
 * chunk."*).
 *
 * ⚠ **ITS OWN FILE, NOT A BLOCK IN `service-reads.test.ts` OR
 * `service-reads-transcript.test.ts`.** Both are near the 500-line cap
 * (INVARIANTS §1) and this suite moves when the PAGING rule moves, not when a
 * read projection or the artifact envelope does — the split
 * `service-reads-transcript.test.ts` already argues for at its head.
 *
 * ⚠ **WHAT IS PROVEN AT THE PURE LEVEL AND IS NOT RE-ASSERTED HERE.**
 * `lib/transcript-line-budget.test.ts` pins the formula and the trim
 * exhaustively over plain arrays. This suite asks the questions those cannot:
 * does the SERVICE apply the budget to the rows the repository returned, does it
 * put `hasMore` on the wire, does the ROW CAP still reach the query, and does the
 * unbudgeted read — the MCP / desktop / await path — come back untouched.
 *
 * Repositories are mocked; `service-shared`, `service-reads` and
 * `service-artifacts` all run for real.
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
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow } from "./dto";
import {
  CHANNEL_TRANSCRIPT_LINE_BUDGET,
  CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS,
} from "../constants";

const WS = "ws-1";
const USER = "user-1";
const CHANNEL = "chan-1";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "user",
  role: "member",
};

/** The query the UI sends — `client/query-keys.ts › channelMessagesParams`. */
const uiQuery = {
  limit: CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS,
  lineBudget: CHANNEL_TRANSCRIPT_LINE_BUDGET,
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
    // ⚠ AT THE NEWEST ROW, so the watermark never writes — this suite is about
    // the page, and a `updateLastRead` call would be noise.
    last_read_at: "2099-01-01T00:00:00.000Z",
    notify_scope: "none",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-09-01T00:00:00Z",
  };
}

function messageRow(seq: number, body: string): ChannelMessageRow {
  return {
    id: `msg-${seq}`,
    seq,
    channel_id: CHANNEL,
    workspace_id: WS,
    author_user_id: USER,
    author_kind: "user",
    kind: "message",
    body,
    metadata: {},
    client_msg_id: null,
    created_at: "2026-09-05T10:00:00.000Z",
    artifact_id: null,
  };
}

/** `n` rows ending at `top`, ascending, each estimating to `lines`. */
function block(top: number, n: number, lines: number): ChannelMessageRow[] {
  const body = Array.from({ length: lines }, (_, i) => `l${i}`).join("\n");
  return Array.from({ length: n }, (_, i) => messageRow(top - n + 1 + i, body));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow());
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map());
  vi.mocked(workspaceRepo.listMemberRolesByUserIds).mockResolvedValue(new Map());
  vi.mocked(repoArtifacts.listArtifactsByIds).mockResolvedValue([]);
  vi.mocked(repoArtifacts.artifactSpans).mockResolvedValue(new Map());
});

describe("readTranscript — the page is sized in LINES", () => {
  it("asks the repository for the ROW CAP, in ONE keyset query", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue(block(200, 200, 2));

    await readTranscript(ctx, "general", { ...uiQuery, before: 500 });

    expect(repoMessages.listMessages).toHaveBeenCalledTimes(1);
    expect(repoMessages.listMessages).toHaveBeenCalledWith(CHANNEL, {
      since: undefined,
      before: 500,
      limit: CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS,
      threadId: undefined,
    });
  });

  it("returns ~150 two-line messages and says there is more", async () => {
    // 300 / 2 = 150. The cap (200) does not bite; the BUDGET does.
    vi.mocked(repoMessages.listMessages).mockResolvedValue(block(200, 200, 2));

    const { messages, hasMore } = await readTranscript(ctx, "general", uiQuery);

    expect(messages).toHaveLength(150);
    // ⚠ THE NEWEST 150, not the oldest — the page a reader is looking at.
    expect(messages[messages.length - 1].seq).toBe(200);
    expect(messages[0].seq).toBe(51);
    expect(hasMore).toBe(true);
  });

  it("returns EXACTLY ONE message when that message alone blows the budget", async () => {
    // 🔒 THE AT-LEAST-ONE RULE. A page of none would latch the client's
    // `exhausted` and hide the whole channel behind one long post.
    const huge = messageRow(90, "x\n".repeat(800));
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      ...block(89, 40, 2),
      huge,
    ]);

    const { messages, hasMore } = await readTranscript(ctx, "general", uiQuery);

    expect(messages.map((m) => m.seq)).toEqual([90]);
    expect(hasMore).toBe(true);
  });

  it("returns all 3 messages of a 3-message channel, with hasMore false", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue(block(3, 3, 2));

    const { messages, hasMore } = await readTranscript(ctx, "general", uiQuery);

    expect(messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(hasMore).toBe(false);
  });

  it("reports hasMore at the ROW CEILING even when the budget trimmed nothing", async () => {
    // ⚠ AT the cap is indistinguishable from OVER it — the rule
    // `listChannelTasks` already applies to `truncated`. It fails toward
    // allowing another fetch, which INVARIANTS §9 requires of a bounded read.
    vi.mocked(repoMessages.listMessages).mockResolvedValue(
      block(200, CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS, 1)
    );

    const { messages, hasMore } = await readTranscript(ctx, "general", uiQuery);

    expect(messages).toHaveLength(CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS);
    expect(hasMore).toBe(true);
  });

  it("CURSOR CONTINUITY — page 2 starts strictly before page 1's oldest", async () => {
    // The keyset argument end to end: the client's next `before` is the oldest
    // returned `seq`, and the rows the budget dropped sit below it, so nothing
    // between the two pages is skipped and nothing is read twice.
    vi.mocked(repoMessages.listMessages).mockResolvedValue(block(200, 200, 2));
    const first = await readTranscript(ctx, "general", uiQuery);
    const cursor = first.messages[0].seq;
    expect(cursor).toBe(51);

    vi.mocked(repoMessages.listMessages).mockResolvedValue(block(50, 50, 2));
    const second = await readTranscript(ctx, "general", {
      ...uiQuery,
      before: cursor,
    });

    expect(repoMessages.listMessages).toHaveBeenLastCalledWith(
      CHANNEL,
      expect.objectContaining({ before: cursor })
    );
    expect(second.messages[second.messages.length - 1].seq).toBeLessThan(cursor);
    expect(second.messages[second.messages.length - 1].seq).toBe(50);
  });
});

describe("readTranscript — the UNBUDGETED read is untouched", () => {
  it("returns every row the repository gave when no lineBudget is asked for", async () => {
    // The MCP / desktop / await path. It pages by ROW and this change is not
    // supposed to reach it — 200 rows of 100 lines each come back whole.
    vi.mocked(repoMessages.listMessages).mockResolvedValue(block(200, 60, 100));

    const { messages, hasMore } = await readTranscript(ctx, "general", {
      limit: 200,
    });

    expect(messages).toHaveLength(60);
    // Well under its own limit, so nothing claims a clip.
    expect(hasMore).toBe(false);
  });

  it("still reports hasMore when an unbudgeted read comes back AT its limit", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue(block(50, 50, 1));

    const { hasMore } = await readTranscript(ctx, "general", { limit: 50 });

    expect(hasMore).toBe(true);
  });
});
