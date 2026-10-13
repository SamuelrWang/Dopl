/**
 * **A TOKEN REACHES THE MESSAGES READ AS A NUMBER** (B6-2, 2026-10-12).
 *
 * ⚠ **THIS FILE EXISTS BECAUSE A MUTATION SURVIVED.** Replacing the decoded
 * cursor in `readMessagePage` with the RAW `query.since` — i.e. skipping the
 * decode entirely on the one path that decodes inside the service — left **4,265
 * tests green**. Nothing in the branch drove a token through the messages read, so
 * the one accept surface that is not a route was effectively unasserted.
 *
 * ⚠ **AND THE FAILURE IT WOULD HAVE SHIPPED IS NOT A TYPE ERROR.** The token is a
 * string, so `gt("seq", "dc1.…")` goes to PostgREST as a filter on a bigint
 * column: the read fails at the database, or worse, silently matches nothing and
 * the caller sees an empty page — "no new messages" — for a cursor that was
 * perfectly valid. A hold on that path would simply go quiet.
 *
 * Repositories are mocked; `service-reads`, `service-shared` and the cursor codec
 * all run for real, so this asserts the wiring rather than a stub.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-collab");
vi.mock("./repository-tasks");
vi.mock("./repository-artifacts");
vi.mock("@/features/workspaces/server/repository");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoArtifacts from "./repository-artifacts";
import { readTranscript } from "./service-reads";
import { encodeChannelCursor } from "./cursor-codec";
import { ChannelCursorUndecodableError } from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelRow } from "./dto";

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
    // At the newest row, so the watermark never writes — noise this suite is not about.
    last_read_at: "2099-01-01T00:00:00.000Z",
    notify_scope: "none",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-09-01T00:00:00Z",
  };
}

/** The `since` that actually reached the repository. */
function sinceAtRepository(): unknown {
  return vi.mocked(repoMessages.listMessages).mock.calls[0][1]?.since;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DOPL_CURSOR_KEY", randomBytes(32).toString("base64"));
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow());
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  // ⚠ `listMessages` returns an ARRAY of rows, not an envelope — copied from the
  // harness next door rather than guessed; my first draft invented both this shape
  // and an `listArtifactsForPage` that does not exist.
  vi.mocked(repoMessages.listMessages).mockResolvedValue([] as never);
  vi.mocked(repoArtifacts.listArtifactsByIds).mockResolvedValue([]);
  vi.mocked(repoArtifacts.artifactSpans).mockResolvedValue(new Map());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the messages read decodes its cursor before the repository", () => {
  it("🔒 a TOKEN arrives at the repository as a NUMBER, for a channel addressed by SLUG", async () => {
    // ⚠ Both halves in one case, because they are one case: `"general"` is a
    // SLUG, and the token is minted for the RESOLVED id. That it decodes at all
    // here is the reason this path decodes inside the service rather than at the
    // route — the route holds only a ref, and binding the token to the ref would
    // have made a slug-addressed read undecodable.
    //
    // (This was two tests that differed by the seq they encoded. One is enough.)
    const token = encodeChannelCursor(4461, { kind: "channel", channelId: CHANNEL }, USER);
    await readTranscript(ctx, "general", { since: token } as never);
    expect(sinceAtRepository()).toBe(4461);
  });

  it("a legacy integer still arrives unchanged", async () => {
    await readTranscript(ctx, "general", { since: 4461 } as never);
    expect(sinceAtRepository()).toBe(4461);
  });

  it("absent stays absent", async () => {
    await readTranscript(ctx, "general", {} as never);
    expect(sinceAtRepository()).toBeUndefined();
  });

  it("🔒 a token for ANOTHER channel is refused before the repository runs", async () => {
    const token = encodeChannelCursor(4461, { kind: "channel", channelId: "chan-2" }, USER);
    await expect(
      readTranscript(ctx, "general", { since: token } as never),
    ).rejects.toThrow(ChannelCursorUndecodableError);
    expect(vi.mocked(repoMessages.listMessages)).not.toHaveBeenCalled();
  });
});
