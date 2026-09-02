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
  listChannelGrantsForBase: vi.fn(),
  upsertChannelKnowledgeGrant: vi.fn(),
  deleteChannelKnowledgeGrant: vi.fn(),
}));

import {
  deleteChannelKnowledgeGrant,
  listChannelGrantsForBase,
  listChannelKnowledgeGrants,
  upsertChannelKnowledgeGrant,
} from "./repository-channel-grants";
import {
  BASE_GRANT_LIMIT,
  canManageChannelGrants,
  getBaseGrantMap,
  getChannelGrantMap,
  setChannelKnowledgeGrant,
} from "./service-channel-grants";
import { ChannelGrantInvalidError, ScopeChangeForbiddenError } from "./errors";
import type { KnowledgeBase, KnowledgeContext } from "../types";

const mockList = vi.mocked(listChannelKnowledgeGrants);
const mockListForBase = vi.mocked(listChannelGrantsForBase);
const mockUpsert = vi.mocked(upsertChannelKnowledgeGrant);
const mockDelete = vi.mocked(deleteChannelKnowledgeGrant);

const OWNER: KnowledgeContext = {
  workspaceId: "ws-1",
  userId: "user-1",
  role: "member",
  source: "user",
  apiKeyWorkspaceId: null,
};
const BASE = { id: "kb-1", createdBy: "user-1" } as KnowledgeBase;

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

describe("getBaseGrantMap — the inverse read (one base, many channels)", () => {
  it("keys by CHANNEL id and bounds the read", async () => {
    mockListForBase.mockResolvedValue([
      {
        channel_id: "chan-1",
        resource_type: "knowledge_base",
        resource_id: "kb-1",
        workspace_id: "ws-1",
        level: "visible" as const,
        guest_write: true,
        created_by: null,
        created_at: "2026-08-27T00:00:00Z",
        updated_at: "2026-08-27T00:00:00Z",
      },
    ]);

    expect(await getBaseGrantMap("ws-1", "kb-1")).toEqual({
      "chan-1": { level: "visible", guestWrite: true },
    });
    // ⚠ PostgREST truncates an un-limited select SILENTLY; the ceiling is passed.
    expect(mockListForBase).toHaveBeenCalledWith(
      { __marker: "admin-client" },
      "ws-1",
      "kb-1",
      BASE_GRANT_LIMIT
    );
  });
});

describe("canManageChannelGrants", () => {
  it("admits the creator and a workspace admin, and nobody else", () => {
    expect(canManageChannelGrants(OWNER, BASE)).toBe(true);
    // A member with `edit` on the CONTENT still may not change the AUDIENCE.
    expect(
      canManageChannelGrants({ ...OWNER, userId: "user-2" }, BASE)
    ).toBe(false);
    expect(
      canManageChannelGrants({ ...OWNER, userId: "user-2", role: "admin" }, BASE)
    ).toBe(true);
    expect(
      canManageChannelGrants({ ...OWNER, userId: "user-2", role: "owner" }, BASE)
    ).toBe(true);
    expect(
      canManageChannelGrants({ ...OWNER, userId: "user-2", role: "viewer" }, BASE)
    ).toBe(false);
  });
});

describe("setChannelKnowledgeGrant — the three-state write", () => {
  function row(level: "agent_only" | "visible", guestWrite: boolean) {
    return {
      channel_id: "chan-1",
      resource_type: "knowledge_base",
      resource_id: "kb-1",
      workspace_id: "ws-1",
      level,
      guest_write: guestWrite,
      created_by: "user-1",
      created_at: "2026-08-27T00:00:00Z",
      updated_at: "2026-08-27T00:00:00Z",
    };
  }

  it("refuses a caller who may not manage sharing, BEFORE any write", async () => {
    await expect(
      setChannelKnowledgeGrant({ ...OWNER, userId: "user-2" }, BASE, {
        channelId: "chan-1",
        level: "visible",
        guestWrite: true,
      })
    ).rejects.toBeInstanceOf(ScopeChangeForbiddenError);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("DELETES the row for `none` and returns null — absence is the third state", async () => {
    mockDelete.mockResolvedValue(undefined);

    const result = await setChannelKnowledgeGrant(OWNER, BASE, {
      channelId: "chan-1",
      level: "none",
      guestWrite: false,
    });

    expect(result).toBeNull();
    expect(mockUpsert).not.toHaveBeenCalled();
    // Workspace-filtered: the PK alone would let a mis-routed call cross tenants.
    expect(mockDelete).toHaveBeenCalledWith(
      { __marker: "admin-client" },
      "ws-1",
      "chan-1",
      "kb-1"
    );
  });

  it("upserts `visible` with the requested guestWrite and the acting user", async () => {
    mockUpsert.mockResolvedValue(row("visible", true));

    const result = await setChannelKnowledgeGrant(OWNER, BASE, {
      channelId: "chan-1",
      level: "visible",
      guestWrite: true,
    });

    expect(result).toEqual({ level: "visible", guestWrite: true });
    expect(mockUpsert).toHaveBeenCalledWith(
      { __marker: "admin-client" },
      {
        workspaceId: "ws-1",
        channelId: "chan-1",
        baseId: "kb-1",
        level: "visible",
        guestWrite: true,
        // ⚠ Off the CONTEXT, never the request.
        createdBy: "user-1",
      }
    );
  });

  it("FORCES guestWrite false at agent_only — that level has no human audience", async () => {
    mockUpsert.mockResolvedValue(row("agent_only", false));

    await setChannelKnowledgeGrant(OWNER, BASE, {
      channelId: "chan-1",
      level: "agent_only",
      guestWrite: true,
    });

    // A stored `true` here would be a latent permission that comes back ON with
    // the audience the moment somebody raises the level to `visible`.
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ level: "agent_only", guestWrite: false })
    );
  });

  it("returns the STORED row, not the requested one", async () => {
    // The server normalises; the client patches its cache from this answer.
    mockUpsert.mockResolvedValue(row("agent_only", false));
    expect(
      await setChannelKnowledgeGrant(OWNER, BASE, {
        channelId: "chan-1",
        level: "agent_only",
        guestWrite: true,
      })
    ).toEqual({ level: "agent_only", guestWrite: false });
  });

  it("translates the trigger's P0001 RAISE into ChannelGrantInvalidError", async () => {
    mockUpsert.mockRejectedValue({
      code: "P0001",
      message:
        "resource_grants: resource workspace mismatch (grant=ws-1, resource=ws-2)",
    });

    const err = await setChannelKnowledgeGrant(OWNER, BASE, {
      channelId: "chan-1",
      level: "visible",
      guestWrite: false,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChannelGrantInvalidError);
    // ⚠ The raw message names both workspace ids — it must not survive.
    expect((err as Error).message).not.toContain("ws-2");
  });

  it("translates a 23503 FK violation the same way — refused, not broken", async () => {
    mockUpsert.mockRejectedValue({ code: "23503", message: "insert violates fk" });
    await expect(
      setChannelKnowledgeGrant(OWNER, BASE, {
        channelId: "chan-1",
        level: "visible",
        guestWrite: false,
      })
    ).rejects.toBeInstanceOf(ChannelGrantInvalidError);
  });

  it("translates a 23514 CHECK violation the same way — the per-scope level set", async () => {
    // `resource_grants_level_check` refuses `read`/`edit` on a channel scope and
    // `visible`/`agent_only` on a team's. It is a refusal, not an outage, and it
    // became reachable when the two vocabularies moved into one column
    // (`20260914120000`).
    mockUpsert.mockRejectedValue({
      code: "23514",
      message: 'violates check constraint "resource_grants_level_check"',
    });
    await expect(
      setChannelKnowledgeGrant(OWNER, BASE, {
        channelId: "chan-1",
        level: "visible",
        guestWrite: false,
      })
    ).rejects.toBeInstanceOf(ChannelGrantInvalidError);
  });

  it("🔒 translates the GRANTOR-MAY-SHARE refusal, and keeps its names off the wire", async () => {
    // The branch ruling B4 added: `enforce_resource_grant()` refuses a grant
    // whose author does not reach both containers. The message names the
    // grantor AND the container they could not reach — an id oracle for
    // anyone who can provoke it.
    mockUpsert.mockRejectedValue({
      code: "P0001",
      message:
        "resource_grants: grantor user-9 may not share into container ws-2",
    });

    const err = await setChannelKnowledgeGrant(OWNER, BASE, {
      channelId: "chan-1",
      level: "visible",
      guestWrite: false,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChannelGrantInvalidError);
    expect((err as Error).message).not.toContain("ws-2");
    expect((err as Error).message).not.toContain("user-9");
  });

  it("RE-THROWS an unrelated P0001 rather than relabelling it a grant refusal", async () => {
    // A bare code match would hand the user a confident 400 explaining a
    // cross-workspace grant that never happened.
    const other = { code: "P0001", message: "some other trigger blew up" };
    mockUpsert.mockRejectedValue(other);
    const err = await setChannelKnowledgeGrant(OWNER, BASE, {
      channelId: "chan-1",
      level: "visible",
      guestWrite: false,
    }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ChannelGrantInvalidError);
    expect(err).toBe(other);
  });

  it("re-throws a plain database error untouched", async () => {
    const boom = new Error("connection reset");
    mockUpsert.mockRejectedValue(boom);
    await expect(
      setChannelKnowledgeGrant(OWNER, BASE, {
        channelId: "chan-1",
        level: "visible",
        guestWrite: false,
      })
    ).rejects.toBe(boom);
  });
});

/**
 * 🔒 THE AGENT REFUSAL — added 2026-08-27, and the reason it is HERE rather
 * than on a route is a second caller.
 *
 * This function's own docblock used to say the source *"is not consulted,
 * because the ROUTE is `sessionOnly`"*, with a note saying where the refusal
 * would belong if that gate were ever relaxed. It was relaxed by
 * `service-base-writes.ts › createBase`'s create-and-share branch, reached from
 * `POST /api/knowledge/bases` — which is NOT `sessionOnly` and must not become
 * so, because MCP `kb_create_base` rides it. So the refusal moved to the one
 * place both doors pass through.
 *
 * ⚠ WHAT IT PROTECTS: a `visible` grant puts a knowledge base in front of every
 * member of a channel, GUESTS INCLUDED. An agent token must not be able to
 * widen its own operator's audience — and a `full`-profile session has Bash and
 * can read the device token off disk, so "the renderer would never send it" is
 * not a fence.
 */
describe("🔒 an AGENT token cannot set a grant, by either door", () => {
  const AGENT: KnowledgeContext = { ...OWNER, source: "agent" };

  it("refuses before touching the repository", async () => {
    await expect(
      setChannelKnowledgeGrant(AGENT, BASE, {
        channelId: "chan-1",
        level: "visible",
        guestWrite: false,
      })
    ).rejects.toMatchObject({ code: "AGENT_WRITE_DISABLED" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("refuses the DELETE arm too — un-sharing is a human decision as well", async () => {
    // ⚠ `level: "none"` takes a different branch below the refusal. An agent
    // that could not share but COULD un-share would still be editing an
    // audience its operator set.
    await expect(
      setChannelKnowledgeGrant(AGENT, BASE, {
        channelId: "chan-1",
        level: "none",
        guestWrite: false,
      })
    ).rejects.toMatchObject({ code: "AGENT_WRITE_DISABLED" });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("refuses even the base's own CREATOR when the credential is an agent", async () => {
    // ⚠ `canManageChannelGrants` would say yes — this is a different axis from
    // "may this person manage sharing", and the order matters: the credential
    // question is asked first, so the answer cannot depend on who owns the row.
    expect(canManageChannelGrants(AGENT, BASE)).toBe(true);
    await expect(
      setChannelKnowledgeGrant(AGENT, BASE, {
        channelId: "chan-1",
        level: "agent_only",
        guestWrite: false,
      })
    ).rejects.toMatchObject({ code: "AGENT_WRITE_DISABLED" });
  });
});
