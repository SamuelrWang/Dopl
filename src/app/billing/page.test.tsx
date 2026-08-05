/**
 * `/billing` — the segment-less forwarder.
 *
 * It exists for the callers that hold a workspace id at best (the 402/403
 * `upgrade_url` envelopes, which MCP agents follow literally, and the public
 * pricing page). Its whole job is: gate, resolve the default workspace, and
 * hand the query on untouched — because the query is what says "open checkout"
 * or "you just paid".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  ensureDefaultWorkspace: vi.fn(),
}));

vi.mock("@/shared/supabase/server", () => ({ getUser: mocks.getUser }));
vi.mock("@/features/workspaces/server/service", () => ({
  ensureDefaultWorkspace: mocks.ensureDefaultWorkspace,
}));

import BillingDefaultWorkspacePage from "./page";

const SEGMENT = "acme-ab12cd34ef56";

async function outcome(
  query: Record<string, string | string[] | undefined> = {}
): Promise<string> {
  try {
    await BillingDefaultWorkspacePage({ searchParams: Promise.resolve(query) });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "RENDERED";
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ id: "user-1" });
  mocks.ensureDefaultWorkspace.mockResolvedValue({
    id: "ws-1",
    name: "Acme",
    slug: "acme",
    publicId: "ab12cd34ef56",
  });
});

describe("the forwarder", () => {
  it("resolves the default workspace and forwards, query intact", async () => {
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
    expect(mocks.ensureDefaultWorkspace).not.toHaveBeenCalled();
  });

  it("never detours through onboarding", async () => {
    // `/canvas` — the page this replaces — sent un-onboarded users to a survey
    // first. Somebody arriving HERE is trying to pay; a survey in front of that
    // is an abandoned checkout, and /onboarding is on the RETIRE list anyway.
    expect(await outcome({ billing: "success", session_id: "cs_1" })).toBe(
      `REDIRECT:/billing/${SEGMENT}?billing=success&session_id=cs_1`
    );
  });
});
