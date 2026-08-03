/**
 * Unit tests for the chats retention window resolver + denial body.
 * Billing entitlements and the repository (the DB-computed cutoff) are
 * mocked — no Supabase, no network. Rules under test:
 *   - free plan  -> resolves a DB cutoff and reports windowDays
 *   - pro plan   -> unbounded (null), no cutoff query fired
 *   - denial body mirrors billing's flat { error, message, upgrade_url }
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceEntitlements } from "@/features/billing/server/entitlements";

vi.mock("@/features/billing/server/entitlements", () => ({
  getWorkspaceEntitlements: vi.fn(),
  FREE_CHATS_WINDOW_DAYS: 90,
  // Real implementation on purpose: the envelope's `upgrade_url` is the
  // contract under test here (GAP-11), not an incidental dependency.
  upgradeUrl: () =>
    `${process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com"}/canvas?billing=upgrade`,
}));
vi.mock("./repository", () => ({
  retentionCutoff: vi.fn(),
}));

import { getWorkspaceEntitlements } from "@/features/billing/server/entitlements";
import * as repo from "./repository";
import { resolveChatsWindow, chatRetentionDeniedBody } from "./retention";

const mockEnt = vi.mocked(getWorkspaceEntitlements);
const mockCutoff = vi.mocked(repo.retentionCutoff);

function ent(chatsWindowDays: number | null): WorkspaceEntitlements {
  return {
    plan: chatsWindowDays === null ? "team" : "free",
    status: chatsWindowDays === null ? "active" : "free",
    memberCount: 1,
    seatCount: null,
    objectCap: null,
    objectsUsed: 0,
    canCreateObjects: true,
    chatsWindowDays,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("resolveChatsWindow", () => {
  it("free plan resolves a DB-computed cutoff for the window", async () => {
    mockEnt.mockResolvedValue(ent(90));
    mockCutoff.mockResolvedValue("2026-04-17");
    const window = await resolveChatsWindow("ws-1");
    expect(window).toEqual({ windowDays: 90, since: "2026-04-17" });
    expect(mockCutoff).toHaveBeenCalledWith(90);
  });

  it("pro plan is unbounded — no cutoff query", async () => {
    mockEnt.mockResolvedValue(ent(null));
    const window = await resolveChatsWindow("ws-1");
    expect(window).toEqual({ windowDays: null, since: null });
    expect(mockCutoff).not.toHaveBeenCalled();
  });
});

describe("chatRetentionDeniedBody", () => {
  it("returns the chat_outside_retention envelope; notes nothing is deleted", () => {
    const body = chatRetentionDeniedBody();
    expect(body.error).toBe("chat_outside_retention");
    expect(body.message.toLowerCase()).toContain("nothing");
    expect(body.message.toLowerCase()).toContain("upgrade");
    expect(body.upgrade_url).toMatch(/\/canvas\?billing=upgrade$/);
  });

  // GAP-11: `/pricing` is a marketing page Phase 4 deletes with the website,
  // and API-first clients (MCP agents) follow this URL literally — so the
  // envelope points at the IN-APP upgrade surface instead.
  it("points at the in-app upgrade surface, never /pricing or the 404 billing route", () => {
    const body = chatRetentionDeniedBody();
    expect(body.upgrade_url).toMatch(/\/canvas\?billing=upgrade$/);
    expect(body.upgrade_url).not.toContain("/pricing");
    expect(body.upgrade_url).not.toContain("/settings/billing");
  });
});
