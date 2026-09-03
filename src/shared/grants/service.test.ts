/**
 * 🔒 **THE GRANT WRITE'S FOUR FENCES, ONE DESCRIBE EACH** — the door that
 * replaced the two copy ops (Wave B slice B15, ruling B11).
 *
 * ⚠ **EACH BLOCK STATES THE MUTATION IT PROTECTS AGAINST**, because a fence that
 * silently stops being applied is indistinguishable from one that is. The order
 * matters as much as the arms: the RESOURCE is fenced before the SCOPE, so an
 * unreachable scope never confirms which resources exist.
 *
 * ⚠ **THE TRIGGER'S OWN ARMS ARE READ OUT OF THE MIGRATION**, not restated here.
 * `scopeContainerId` is a TypeScript copy of `enforce_resource_grant()`'s scope
 * `CASE`, kept only so the refusal is a 404 at the door instead of a `P0001`
 * from a trigger — and a copy with no gate is the drift shape this repo has been
 * bitten by repeatedly, so the last block reads both.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/shared/tenancy/resolve-resource", () => ({ resolveResource: vi.fn() }));
vi.mock("@/features/workspaces/server/repository", () => ({
  findMembership: vi.fn(),
}));
vi.mock("@/features/workspaces/server/service-overview", () => ({
  isChannelVisibleTo: vi.fn(),
}));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { resolveResource } from "@/shared/tenancy/resolve-resource";
import { findMembership } from "@/features/workspaces/server/repository";
import { isChannelVisibleTo } from "@/features/workspaces/server/service-overview";
import { HttpError } from "@/shared/lib/http-error";
import { grantResource, isGrantValidityViolation } from "./service";
import { ResourceGrantWriteSchema } from "./schema";

const ME = "22222222-3333-4444-5555-666666666666";
const RESOURCE_WS = "11111111-2222-3333-4444-555555555555";
const SCOPE_WS = "99999999-8888-7777-6666-555555555555";
const KB = "44444444-4444-4444-4444-444444444444";
const CHANNEL = "55555555-5555-4555-8555-555555555555";

const caller = { userId: ME, credentialSubjectUserId: ME };

const INPUT = {
  resourceType: "knowledge_base",
  resourceId: KB,
  scopeType: "channel",
  scopeId: CHANNEL,
  level: "visible",
} as const;

/** A recording builder: `scopeContainerId`'s read, then the upsert. */
function makeAdmin(scopeRow: Record<string, unknown> | null, upsertError: unknown = null) {
  const upsert = vi.fn(() => Promise.resolve({ error: upsertError }));
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    from: () => builder,
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: scopeRow, error: null }),
    upsert,
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return upsert;
}

function resolved(over: Record<string, unknown> = {}) {
  return {
    type: "knowledge_base",
    id: KB,
    name: "Runbooks",
    containerId: RESOURCE_WS,
    containerName: "Acme",
    containerKind: "standard",
    ownedByCaller: true,
    containerRole: "member",
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveResource).mockResolvedValue(resolved());
  vi.mocked(findMembership).mockResolvedValue({ role: "member" } as never);
  vi.mocked(isChannelVisibleTo).mockResolvedValue(true);
});

// ── Fence 2 — the resource is the caller's own ────────────────────────────

describe("the RESOURCE fence", () => {
  it("files the row under the RESOURCE's container, never the scope's", async () => {
    // 🔒 MUTATION CHECK — rule 3 of the migration header. Send the scope's
    // container and `enforce_resource_grant()` raises a workspace mismatch on
    // every legitimate cross-container lend, which is the whole point of B11.
    const upsert = makeAdmin({ workspace_id: SCOPE_WS });
    await grantResource(caller, { ...INPUT });
    expect(upsert).toHaveBeenCalledWith(
      {
        scope_type: "channel",
        scope_id: CHANNEL,
        resource_type: "knowledge_base",
        resource_id: KB,
        workspace_id: RESOURCE_WS,
        level: "visible",
        created_by: ME,
      },
      // ⚠ THE UPSERT KEY IS THE TABLE'S PRIMARY KEY. Anything else and a repeat
      // call inserts a second row the PK then rejects, so a retry after an
      // ambiguous failure stops being safe.
      { onConflict: "scope_type,scope_id,resource_type,resource_id" }
    );
  });

  it("🔒 404s a resource the caller did not create (R2), before touching the scope", async () => {
    vi.mocked(resolveResource).mockResolvedValue(resolved({ ownedByCaller: false }));
    makeAdmin({ workspace_id: SCOPE_WS });
    await expect(grantResource(caller, { ...INPUT })).rejects.toMatchObject({
      status: 404,
    });
    // ⚠ ORDER IS A FENCE: reaching the scope read at all would make an
    // unreachable-scope answer distinguishable from a not-yours answer.
    expect(findMembership).not.toHaveBeenCalled();
  });

  it("404s an unresolvable resource with the SAME answer", async () => {
    vi.mocked(resolveResource).mockResolvedValue(null);
    makeAdmin({ workspace_id: SCOPE_WS });
    await expect(grantResource(caller, { ...INPUT })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses a resource type that has no resolver rather than 404ing on a null", async () => {
    makeAdmin({ workspace_id: SCOPE_WS });
    await expect(
      grantResource(caller, { ...INPUT, resourceType: "chat_folder" as never })
    ).rejects.toBeInstanceOf(HttpError);
    expect(resolveResource).not.toHaveBeenCalled();
  });
});

// ── Fence 3 — the caller reaches the scope ────────────────────────────────

describe("the SCOPE fence", () => {
  it("404s a scope that does not exist", async () => {
    makeAdmin(null);
    await expect(grantResource(caller, { ...INPUT })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("404s a scope the caller is only a VIEWER of — lending is a member+ act", async () => {
    vi.mocked(findMembership).mockResolvedValue({ role: "viewer" } as never);
    makeAdmin({ workspace_id: SCOPE_WS });
    await expect(grantResource(caller, { ...INPUT })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("🔒 404s a CHANNEL the caller cannot see, with the same answer", async () => {
    // ⚠ The `?channelId=` precedent: "cannot see" and "does not exist" must stay
    // indistinguishable, or the write becomes a channel oracle.
    vi.mocked(isChannelVisibleTo).mockResolvedValue(false);
    const upsert = makeAdmin({ workspace_id: SCOPE_WS });
    await expect(grantResource(caller, { ...INPUT })).rejects.toMatchObject({
      status: 404,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("does NOT ask the channel question of a container scope", async () => {
    makeAdmin({ id: SCOPE_WS });
    await grantResource(caller, {
      ...INPUT,
      scopeType: "container",
      scopeId: SCOPE_WS,
      level: "read",
    });
    expect(isChannelVisibleTo).not.toHaveBeenCalled();
  });
});

// ── Fence 4 — the trigger, and the CASE this file copies from it ──────────

describe("the TRIGGER's refusals", () => {
  it("becomes a 400 for every arm, and rethrows anything else", async () => {
    for (const error of [
      { code: "P0001", message: "resource_grants: channel … does not exist" },
      { code: "23514" },
      { code: "23503" },
    ]) {
      makeAdmin({ workspace_id: SCOPE_WS }, error);
      await expect(grantResource(caller, { ...INPUT })).rejects.toMatchObject({
        status: 400,
      });
    }
    // ⚠ A BARE `P0001` IS NOT OURS. Every plpgsql RAISE in the write path is
    // `P0001`, so matching the code alone would relabel an unrelated trigger's
    // failure as a refused grant and hand the caller a confident wrong reason.
    expect(isGrantValidityViolation({ code: "P0001", message: "boom" })).toBe(false);
    makeAdmin({ workspace_id: SCOPE_WS }, { code: "P0001", message: "boom" });
    await expect(grantResource(caller, { ...INPUT })).rejects.not.toMatchObject({
      status: 400,
    });
  });

  it("🔒 the scope CASE this file copies still matches the trigger's, arm for arm", () => {
    // ⚠ MUTATION CHECK ACROSS THE TS/SQL SEAM. `scopeContainerId` exists only to
    // turn a trigger RAISE into a 404 at the door; an arm that drifts sends a
    // legal grant to a 404 or an illegal one to a 500.
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260914120000_resource_grants.sql"),
      "utf8"
    );
    for (const [scope, table, column] of [
      ["channel", "channels", "workspace_id"],
      ["container", "workspaces", "id"],
      ["team", "teams", "workspace_id"],
    ] as const) {
      expect(
        sql,
        `the trigger's ${scope} arm no longer reads ${table}.${column}`
      ).toMatch(
        new RegExp(`WHEN\\s+'${scope}'\\s+THEN\\s+SELECT\\s+${column}\\s+INTO\\s+scope_ws\\s+FROM\\s+${table}\\b`)
      );
    }
    // ⚠ AND THE SCHEMA ACCEPTS EXACTLY THOSE THREE — a fourth would reach a
    // `scopeContainerId` with no arm for it.
    expect(
      ResourceGrantWriteSchema.safeParse({ ...INPUT, scopeType: "nope" }).success
    ).toBe(false);
  });

  it("refuses a level from the other scope's vocabulary at the door", () => {
    // ⚠ Cross-field, so it cannot be a plain enum: `resource_grants_level_check`
    // is a `CASE` over `scope_type`, and without this the body reaches Postgres
    // to be refused with `23514` and no field name.
    expect(ResourceGrantWriteSchema.safeParse({ ...INPUT, level: "read" }).success).toBe(false);
    expect(
      ResourceGrantWriteSchema.safeParse({
        ...INPUT,
        scopeType: "container",
        level: "visible",
      }).success
    ).toBe(false);
    expect(
      ResourceGrantWriteSchema.safeParse({ ...INPUT, scopeType: "container", level: "edit" })
        .success
    ).toBe(true);
  });
});
