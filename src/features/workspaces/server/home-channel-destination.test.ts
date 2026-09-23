/**
 * 🔒 **A HOME CHANNEL HOLDS ONLY WHAT IS SHARED INTO IT** — the SERVER fence for
 * Samuel's ruling of 2026-09-18, pinned at the one place both features ask it.
 *
 * ⚠ **THE POINT OF THE SUITE IS THE KIND AXIS.** The rule is a property of ONE
 * container kind, so the cases that matter most are the ones it must NOT fire
 * for: a `kind='personal'` container is destination 1 and is made of private
 * rows, and a `kind='standard'` workspace lists its own private rows on its own
 * pages. A negative spelling (`!isStandardWorkspace`) would have refused the
 * first of those — that is F-564's shape, and it is why this asks
 * `kind === "link"` positively.
 *
 * ⚠ The per-feature wiring — which boolean each one passes for `shared` — is
 * pinned by `agent-identities/server/service-writes.test.ts` and
 * `knowledge/server/service-base-gates.test.ts`. This file is about the rule.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("./repository", () => ({
  findWorkspaceById: vi.fn(),
}));

import { findWorkspaceById } from "./repository";
import {
  assertHomeChannelRowIsShared,
  HomeChannelRowNotSharedError,
} from "./home-channel-destination";

const found = vi.mocked(findWorkspaceById);

const ROW = {
  workspaceId: "ws-1",
  shared: false,
  noun: "agent identity",
  remedy: 'visibility: "workspace"',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asWorkspace = (kind: string | undefined) => ({ id: "ws-1", kind }) as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertHomeChannelRowIsShared", () => {
  it("🚫 REFUSES a private, ungranted row in a `kind='link'` container", async () => {
    found.mockResolvedValue(asWorkspace("link"));
    await expect(assertHomeChannelRowIsShared(ROW)).rejects.toBeInstanceOf(
      HomeChannelRowNotSharedError,
    );
  });

  it("the refusal is a 400 with a code, and names BOTH destinations", async () => {
    // ⚠ 400, NOT 403 — G16's argument one axis over: the caller MAY author here,
    // the request names a destination that does not exist. A 403 would read as
    // "you may not create in this channel", which is false.
    found.mockResolvedValue(asWorkspace("link"));
    const err = await assertHomeChannelRowIsShared(ROW).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe("HOME_CHANNEL_ROW_NOT_SHARED");
    expect(err.message).toContain('visibility: "workspace"');
    expect(err.message).toContain("home space");
    // ⚠ AND IT SAYS NOTHING LANDED. A refusal an agent reads as a partial write
    // is a refusal it retries against a row that does not exist.
    expect(err.message).toContain("was not created");
  });

  it("✅ ALLOWS a SHARED row in the same container, and asks nothing to find out", async () => {
    // ⚠ ONE READ, AND ONLY ON THE PRIVATE LANE — every create-and-share and
    // every workspace write pays nothing.
    await expect(
      assertHomeChannelRowIsShared({ ...ROW, shared: true }),
    ).resolves.toBeUndefined();
    expect(found).not.toHaveBeenCalled();
  });

  it("✅ ALLOWS a private row in the caller's PERSONAL container — that IS destination 1", async () => {
    // 🔒 **THE CASE A NEGATIVE PREDICATE WOULD HAVE BROKEN.** `!isStandardWorkspace`
    // is true of `personal`, so spelling the fence that way would refuse every
    // Home create — the entire first destination.
    found.mockResolvedValue(asWorkspace("personal"));
    await expect(assertHomeChannelRowIsShared(ROW)).resolves.toBeUndefined();
  });

  it("✅ WORKSPACES ARE OUT OF SCOPE — `kind='standard'` is untouched", async () => {
    // ⚠ Samuel scoped the ruling to the home space, and a workspace lists its
    // own private rows on its own Agents / Knowledge page: no orphan, nothing to
    // refuse.
    found.mockResolvedValue(asWorkspace("standard"));
    await expect(assertHomeChannelRowIsShared(ROW)).resolves.toBeUndefined();
  });

  it("✅ AN ABSENT `kind` READS AS STANDARD — a narrowed projection is not a refusal", async () => {
    found.mockResolvedValue(asWorkspace(undefined));
    await expect(assertHomeChannelRowIsShared(ROW)).resolves.toBeUndefined();
  });

  it("✅ A MISSING WORKSPACE ROW PASSES — this gate is not the one that reports it", async () => {
    // ⚠ `withWorkspaceAuth` proved an active membership before this ran, so
    // `null` means the row vanished mid-request and the write underneath is
    // about to fail on its own (`shared-publish.ts` states the same rule).
    found.mockResolvedValue(null);
    await expect(assertHomeChannelRowIsShared(ROW)).resolves.toBeUndefined();
  });

  it("✅ A KIND NOBODY HAS DESIGNED YET IS NOT REFUSED", async () => {
    // ⚠ The mirror of the positive spelling: this states a property of `link`,
    // so a fourth kind opts IN rather than inheriting a refusal about a surface
    // that does not exist for it yet.
    found.mockResolvedValue(asWorkspace("something-new"));
    await expect(assertHomeChannelRowIsShared(ROW)).resolves.toBeUndefined();
  });
});
