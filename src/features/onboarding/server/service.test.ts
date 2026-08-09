/**
 * THE THIRD HAND COPY OF THE WORKSPACE HOME PATH — and the drift alarm it
 * was missing.
 *
 * `completeOnboarding` returns the URL a brand-new user is redirected to the
 * instant they finish signup. It builds that URL from a hardcoded
 * `"/overview"`, which is a hand copy of `WORKSPACE_HOME_PATH` in
 * `apps/desktop-ui/src/routes.tsx` — the SPA's index-redirect target and the
 * one place that string is defined.
 *
 * Two other copies of it exist and BOTH have this alarm:
 *   • `apps/desktop-ui/src/routes.test.tsx` pins the constant itself.
 *   • `dopl-desktop-app/main/deep-link-target.js` (`WORKSPACE_HOME_PAGE`) is
 *     regex-compared against routes.tsx by its own test.
 *
 * This one had none, on the newest-user funnel. Repointing the SPA home page
 * (say `overview` → `home`) would leave this string behind and drop every
 * newly onboarded user on the "Not found" route — with the whole suite green,
 * because the only coverage of the value mocked it.
 *
 * Server code cannot IMPORT the constant: `routes.tsx` is a different npm
 * workspace, uses `#/` aliases, and pulls in every page component. So the test
 * reads the source and compares, exactly like the deep-link test does.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/features/analytics/server/conversion-events", () => ({
  logConversionEvent: vi.fn(),
  hasFiredEvent: vi.fn(),
}));
vi.mock("@/features/workspaces/server/service", () => ({
  renameDefaultWorkspaceIfUntitled: vi.fn(),
}));
vi.mock("./repository", () => ({
  findDisplayName: vi.fn(),
  findOnboardedAt: vi.fn(),
  hasActiveMcpToken: vi.fn(),
  markOnboarded: vi.fn(),
}));

import { renameDefaultWorkspaceIfUntitled } from "@/features/workspaces/server/service";
import { markOnboarded } from "./repository";
import { completeOnboarding } from "./service";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES_TSX = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "desktop-ui",
  "src",
  "routes.tsx"
);

/** `WORKSPACE_HOME_PATH` as the SPA actually declares it — the only source. */
function spaWorkspaceHomePath(): string {
  const src = readFileSync(ROUTES_TSX, "utf8");
  const match = /export const WORKSPACE_HOME_PATH = "([^"]+)"/.exec(src);
  expect(
    match,
    "could not find WORKSPACE_HOME_PATH in apps/desktop-ui/src/routes.tsx — " +
      "if it was renamed, this alarm and the deep-link one both need updating"
  ).not.toBeNull();
  return match![1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renameDefaultWorkspaceIfUntitled).mockResolvedValue({
    id: "ws-1",
    slug: "acme",
    publicId: "a1b2c3d4e5f6",
    name: "Acme",
  } as never);
  vi.mocked(markOnboarded).mockResolvedValue(false);
});

describe("completeOnboarding redirect target", () => {
  it("lands the new user on the SPA's real workspace home page", async () => {
    // NOT `toBe("/acme-a1b2c3d4e5f6/overview")`: a literal here would be a
    // FOURTH hand copy and would keep passing after a repoint. The expected
    // value is read out of routes.tsx.
    const { redirectPath } = await completeOnboarding("user-1", {
      mcpConnected: true,
      name: "Acme",
    });
    expect(redirectPath).toBe(`/acme-a1b2c3d4e5f6/${spaWorkspaceHomePath()}`);
  });

  it("routes to a page the SPA actually has (not the catch-all)", async () => {
    // A correct-looking path is still a 'Not found' if no route serves it —
    // pin the page against the route table too, the way the deep-link test
    // pins its page map.
    const { redirectPath } = await completeOnboarding("user-1", {
      mcpConnected: false,
    });
    const page = redirectPath.split("/").slice(2).join("/");
    const src = readFileSync(ROUTES_TSX, "utf8");
    expect(src).toContain(`{ path: "${page}",`);
  });
});
