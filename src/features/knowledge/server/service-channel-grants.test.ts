/**
 * `getChannelGrantMap` — the read behind `GET /api/knowledge/bases?channelId= ›
 * channelGrants`. Pins: BOTH stored levels ride the map (`agent_only` is badged
 * by the UI, not hidden here — the read lane is where it becomes a 404); a base
 * with no grant is ABSENT (never `'none'`); the repo is handed the service-role
 * client and the caller's workspace/channel/base-id set verbatim.
 *
 * ⚠ §3.3 ABSENCE PIN: this module must NOT reuse the workspace gate half. The
 * source is scanned below for any import of `service-shared` — `canSeeBase` /
 * `assertBaseVisible` encode the wrong (workspace) audience for a channel grant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("./repository-channel-grants", () => ({
  listChannelKnowledgeGrants: vi.fn(),
}));

import { listChannelKnowledgeGrants } from "./repository-channel-grants";
import { getChannelGrantMap } from "./service-channel-grants";

const mockList = vi.mocked(listChannelKnowledgeGrants);

function row(resourceId: string, level: "agent_only" | "visible", guestWrite: boolean) {
  return {
    channel_id: "chan-1",
    resource_type: "knowledge_base",
    resource_id: resourceId,
    workspace_id: "ws-1",
    level,
    guest_write: guestWrite,
    created_by: null,
    created_at: "2026-08-27T00:00:00Z",
    updated_at: "2026-08-27T00:00:00Z",
  };
}

beforeEach(() => vi.clearAllMocks());

describe("getChannelGrantMap", () => {
  it("keys rows by base id and carries BOTH levels plus guestWrite", async () => {
    mockList.mockResolvedValue([
      row("kb-1", "visible", true),
      row("kb-2", "agent_only", false),
    ]);

    const map = await getChannelGrantMap("ws-1", "chan-1", ["kb-1", "kb-2"]);

    expect(map).toEqual({
      "kb-1": { level: "visible", guestWrite: true },
      "kb-2": { level: "agent_only", guestWrite: false },
    });
  });

  it("hands the repo the service-role client and the caller's args verbatim", async () => {
    mockList.mockResolvedValue([]);
    await getChannelGrantMap("ws-9", "chan-9", ["kb-a", "kb-b"]);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(
      { __marker: "admin-client" },
      "ws-9",
      "chan-9",
      ["kb-a", "kb-b"]
    );
  });

  it("returns {} — an ungranted base is ABSENT, not 'none'", async () => {
    mockList.mockResolvedValue([]);
    expect(await getChannelGrantMap("ws-1", "chan-1", ["kb-1"])).toEqual({});
  });

  it("names neither service-shared gate — the workspace audience is the wrong question", () => {
    // ABSENCE pin (link-container-guard technique): a 'tidy-up' that routes this
    // read through canSeeBase / assertBaseVisible would silently refuse guests,
    // and no behavioural mock in M0 would notice.
    const src = readFileSync(
      resolve(__dirname, "service-channel-grants.ts"),
      "utf8"
    );
    // An actual import statement, not the docblock that explains its absence.
    expect(src).not.toMatch(/from\s+["'][^"']*service-shared/);
    // An actual call, not a prose mention.
    expect(src).not.toMatch(
      /canSeeBase\(|assertBaseVisible\(|requireEffectiveAccess\(/
    );
  });
});
