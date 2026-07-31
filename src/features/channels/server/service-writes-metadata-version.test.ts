/**
 * Q10 — the `appVersion` stamp, and the header layer that feeds it.
 *
 * WHY IT MATTERS. electron-updater downloads in the background and installs ON
 * QUIT; a background listener app is quit approximately never. A peer therefore
 * ran 1.7.14 for a full evening after 1.7.15 shipped, and the released fix read
 * as broken because neither side could see it was not running. The stamp makes
 * that visible from the other machine.
 *
 * It is a RESERVED key on exactly the terms `runtime` is: the header is the only
 * input, `resolvePostMetadata` is the only stamping point, and a caller-supplied
 * copy is stripped there. This file pins both halves — the header predicate (a
 * version or nothing, never attacker-chosen prose) and the strip/stamp fold.
 *
 * Kept out of `service-writes-metadata.test.ts` only because that file is at the
 * §2 size cap; the harness below is the same one, trimmed to this fold.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import {
  APP_VERSION_HEADER,
  narrowAppVersion,
  readAppVersionHeader,
} from "@/shared/auth/app-version-header";
import { postMessage } from "./service-writes";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
} from "./dto";
import { buildChannelContext, type ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "agent",
  role: "member",
};

function channelRow(): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "dm",
    name: "Direct message",
    topic: "",
    visibility: "private",
    is_direct: true,
    direct_key: [USER, PEER].sort().join(":"),
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
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
    added_by: USER,
    joined_at: "2026-07-31T00:00:00Z",
  };
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 98,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-07-31T00:00:00Z",
  };
}

function capturedMetadata(): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
}

function has(meta: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
}

const withHeader = (value: string) =>
  ({ headers: new Headers({ [APP_VERSION_HEADER]: value }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    userId === USER || userId === PEER ? memberRow(userId) : null
  );
  vi.mocked(repo.listMembers).mockResolvedValue([
    memberRow(USER, "owner"),
    memberRow(PEER),
  ]);
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([]);
});

describe("readAppVersionHeader — a version, or nothing", () => {
  it("accepts a plain build and a short pre-release tag", () => {
    expect(readAppVersionHeader(withHeader("1.7.15"))).toBe("1.7.15");
    expect(readAppVersionHeader(withHeader("1.8.0-beta.2"))).toBe("1.8.0-beta.2");
    expect(readAppVersionHeader(withHeader("0.0.1"))).toBe("0.0.1");
  });

  it("refuses everything that is not one", () => {
    // The value is echoed to a human on another machine, so free text is the
    // whole risk: a refused header stamps NOTHING rather than a sentence.
    for (const bad of [
      "",
      "v1.7.15",
      "1.7",
      "1.7.15.1",
      "1.7.15 (stale, ask them to restart)",
      "latest",
      "99999.1.1",
      "1.7.15-" + "x".repeat(40),
      "<script>alert(1)</script>",
    ]) {
      expect(readAppVersionHeader(withHeader(bad))).toBeUndefined();
    }
  });

  it("is undefined when the header is absent", () => {
    expect(readAppVersionHeader({ headers: new Headers() })).toBeUndefined();
  });

  it("buildChannelContext re-narrows what the auth layer handed it", () => {
    // Same predicate, applied twice: no other construction path can widen it.
    expect(
      buildChannelContext({ userId: USER, workspaceId: WS, appVersion: "1.7.15" })
        .appVersion
    ).toBe("1.7.15");
    expect(
      buildChannelContext({ userId: USER, workspaceId: WS, appVersion: "stale" })
        .appVersion
    ).toBeUndefined();
    expect(
      buildChannelContext({ userId: USER, workspaceId: WS }).appVersion
    ).toBeUndefined();
    expect(narrowAppVersion(null)).toBeUndefined();
  });
});

describe("postMessage — appVersion stamp (Q10)", () => {
  const desktopCtx: ChannelContext = { ...ctx, appVersion: "1.7.15" };

  it("stamps the version when the request carried the header", async () => {
    const msg = await postMessage(desktopCtx, "dm", { body: "on it" });

    expect(capturedMetadata().appVersion).toBe("1.7.15");
    expect(msg.metadata.appVersion).toBe("1.7.15");
  });

  it("stamps NO appVersion key when the header is absent", async () => {
    await postMessage(ctx, "dm", { body: "on it" });

    expect(has(capturedMetadata(), "appVersion")).toBe(false);
  });

  it("SECURITY: a caller-supplied metadata.appVersion is stripped, header or not", async () => {
    await postMessage(ctx, "dm", {
      body: "claiming to be current",
      metadata: { appVersion: "9.9.9", keep: 1 },
    });

    const meta = capturedMetadata();
    expect(has(meta, "appVersion")).toBe(false);
    // Only the reserved key is taken — unrelated caller metadata survives.
    expect(meta.keep).toBe(1);
  });

  it("SECURITY: a spoofed value never survives a real desktop post either", async () => {
    await postMessage(desktopCtx, "dm", {
      body: "hi",
      metadata: { appVersion: "9.9.9" },
    });

    expect(capturedMetadata().appVersion).toBe("1.7.15");
  });

  it("rides alongside the other server-owned keys without disturbing them", async () => {
    const meta = await postMessage(
      { ...desktopCtx, runtime: "desktop-session" },
      "dm",
      { body: "on it" }
    ).then(() => capturedMetadata());

    expect(meta.appVersion).toBe("1.7.15");
    expect(meta.runtime).toBe("desktop-session");
    expect(meta.to_user_id).toBe(PEER);
  });
});
