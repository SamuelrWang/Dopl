/**
 * `/billing` — the segment-less entry: gate, forward the caller who has exactly
 * ONE owned standard workspace (query intact — the query is what says "open
 * checkout" or "you just paid"), and ASK everyone else.
 *
 * 🔒 **THE ASK IS THE POINT (ruling B10).** This page used to forward whoever
 * arrived to a derived "default" workspace, so an account owning two of them
 * paid on the older one and had no way to see that a choice had been made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  findSoleOwnedStandardWorkspace: vi.fn(),
  listMyWorkspacesWithRole: vi.fn(),
}));

vi.mock("@/shared/supabase/server", () => ({ getUser: mocks.getUser }));
vi.mock("@/features/workspaces/server/repository", () => ({
  findSoleOwnedStandardWorkspace: mocks.findSoleOwnedStandardWorkspace,
}));
vi.mock("@/features/workspaces/server/service", () => ({
  listMyWorkspacesWithRole: mocks.listMyWorkspacesWithRole,
}));

import BillingWorkspacePickerPage from "./page";

const SEGMENT = "acme-ab12cd34ef56";

function ws(over: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    name: "Acme",
    slug: "acme",
    publicId: "ab12cd34ef56",
    role: "owner",
    ...over,
  };
}

/** The redirect message, or the rendered markup when the page renders. */
async function outcome(
  query: Record<string, string | string[] | undefined> = {}
): Promise<string> {
  try {
    const el = await BillingWorkspacePickerPage({
      searchParams: Promise.resolve(query),
    });
    return renderToStaticMarkup(el);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ id: "user-1" });
  mocks.findSoleOwnedStandardWorkspace.mockResolvedValue({
    workspace: ws(),
    count: 1,
  });
  mocks.listMyWorkspacesWithRole.mockResolvedValue([]);
});

describe("the forwarder — exactly one owned standard workspace", () => {
  it("forwards, query intact", async () => {
    expect(await outcome({ billing: "upgrade" })).toBe(
      `REDIRECT:/billing/${SEGMENT}?billing=upgrade`
    );
  });

  it("forwards a bare visit too", async () => {
    expect(await outcome()).toBe(`REDIRECT:/billing/${SEGMENT}`);
  });

  it("bounces a signed-out visitor with the query in redirectTo", async () => {
    mocks.getUser.mockResolvedValue(null);
    expect(await outcome({ billing: "upgrade" })).toBe(
      `REDIRECT:/login?redirectTo=${encodeURIComponent("/billing?billing=upgrade")}`
    );
    expect(mocks.findSoleOwnedStandardWorkspace).not.toHaveBeenCalled();
  });

  it("never detours through onboarding", async () => {
    // Somebody arriving here is trying to pay; a survey in front of that is an
    // abandoned checkout.
    expect(await outcome({ billing: "success", session_id: "cs_1" })).toBe(
      `REDIRECT:/billing/${SEGMENT}?billing=success&session_id=cs_1`
    );
  });
});

describe("🔒 the picker — anything else ASKS rather than guessing", () => {
  beforeEach(() => {
    mocks.findSoleOwnedStandardWorkspace.mockResolvedValue({
      workspace: null,
      count: 2,
    });
  });

  it("renders one link PER workspace, each carrying the query", async () => {
    mocks.listMyWorkspacesWithRole.mockResolvedValue([
      ws(),
      ws({ id: "ws-2", name: "Beta", slug: "beta", publicId: "cd34ef56ab12", role: "admin" }),
    ]);

    const html = await outcome({ billing: "upgrade" });
    // ⚠ NOT a redirect: the assertion that the guess is gone.
    expect(html).not.toContain("REDIRECT:");
    expect(html).toContain(`/billing/${SEGMENT}?billing=upgrade`);
    expect(html).toContain("/billing/beta-cd34ef56ab12?billing=upgrade");
  });

  it("lists memberships, not only ownership — an admin may open that page", async () => {
    mocks.listMyWorkspacesWithRole.mockResolvedValue([
      ws({ id: "ws-2", name: "Beta", slug: "beta", publicId: "cd34ef56ab12", role: "admin" }),
    ]);
    expect(await outcome()).toContain("Beta");
  });

  it("omits containers — neither kind carries a plan", async () => {
    mocks.listMyWorkspacesWithRole.mockResolvedValue([
      ws(),
      ws({ id: "ws-link", name: "Link", slug: "link", publicId: "111111111111", kind: "link" }),
      ws({ id: "ws-home", name: "Home", slug: "personal", publicId: "222222222222", kind: "personal" }),
    ]);

    const html = await outcome();
    expect(html).toContain("Acme");
    expect(html).not.toContain("ws-link");
    expect(html).not.toContain("/billing/link-111111111111");
    expect(html).not.toContain("/billing/personal-222222222222");
  });

  it("a caller in no workspace at all is told so, not redirected into nowhere", async () => {
    mocks.findSoleOwnedStandardWorkspace.mockResolvedValue({
      workspace: null,
      count: 0,
    });
    const html = await outcome();
    expect(html).not.toContain("REDIRECT:");
    expect(html).toContain("not in one yet");
  });
});
