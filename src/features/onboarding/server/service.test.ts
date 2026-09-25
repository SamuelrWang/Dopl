/**
 * ⚠ **DRIFT ALARM, AND THE CONSTANT IT WATCHES CHANGED ON 2026-09-10.**
 * `completeOnboarding` lands a new user on `/home` now, not on
 * `/{segment}/overview`: what onboarding names is a `kind='home'` container,
 * and a container has no workspace shell to open. So the path this file must keep
 * honest is the SPA's ROOT `HOME_PATH`, and `WORKSPACE_HOME_PATH` is pinned here
 * only as the fallback for the branch a non-home space would take.
 *
 * Source of truth for each:
 * `HOME_PATH` — `apps/desktop-ui/src/components/app-shell/account-rail.tsx`,
 * registered in `routes.tsx` as a ROOT route (sibling of `/:workspaceSegment`,
 * because /home mounts its own frame). Other copies + their alarms:
 * `dopl-desktop-app/main/deep-link-target.js` › ROOT_ROUTES, and
 * `./service.ts` › completeOnboarding (the literal this pins).
 * `WORKSPACE_HOME_PATH` — `apps/desktop-ui/src/routes.tsx`, also copied in
 * `apps/desktop-ui/src/routes.test.tsx` and `deep-link-target.js` ›
 * WORKSPACE_HOME_PAGE.
 *
 * Repointing either would drop a newly onboarded user on "Not found" with the
 * suite green. Server code cannot IMPORT them (different npm workspace, `#/`
 * aliases, pulls in every page component) — so read the source and compare.
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
  HOME_SPACE_DEFAULT_NAME: "Home",
  renameHomeSpaceIfPlaceholder: vi.fn(),
}));
vi.mock("./repository", () => ({
  findDisplayName: vi.fn(),
  findOnboardedAt: vi.fn(),
  hasActiveMcpToken: vi.fn(),
  markOnboarded: vi.fn(),
}));

import { renameHomeSpaceIfPlaceholder } from "@/features/workspaces/server/service";
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

const ACCOUNT_RAIL_TSX = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "desktop-ui",
  "src",
  "components",
  "app-shell",
  "account-rail.tsx"
);

/** `HOME_PATH` as the SPA actually declares it — the only source. */
function spaHomePath(): string {
  const src = readFileSync(ACCOUNT_RAIL_TSX, "utf8");
  const match = /export const HOME_PATH = "([^"]+)"/.exec(src);
  expect(
    match,
    "could not find HOME_PATH in apps/desktop-ui/src/components/app-shell/" +
      "account-rail.tsx — if it moved, this alarm, routes.tsx's root route and " +
      "dopl-desktop-app/main/deep-link-target.js all need updating"
  ).not.toBeNull();
  return match![1];
}

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
  vi.mocked(renameHomeSpaceIfPlaceholder).mockResolvedValue({
    id: "ws-1",
    slug: "acme",
    publicId: "a1b2c3d4e5f6",
    name: "Acme",
    // ⚠ THE FIXTURE CARRIES `kind` NOW — it is what the landing branches on, and
    // the real function only ever answers a home space.
    kind: "home",
  } as never);
  vi.mocked(markOnboarded).mockResolvedValue(false);
});

describe("completeOnboarding redirect target", () => {
  /**
   * 🔒 **THE NEW USER LANDS ON `/home`, NOT INSIDE THE WORKSPACE SHELL
   * (2026-09-10).** This case asserted `/{segment}/overview` and was RIGHT about
   * the thing it was watching — the path existed and rendered — which is why the
   * wrong room was never caught here. Onboarding names a `kind='home'`
   * container; that row is a SHELF (`20260920120000`'s header) and its surface is
   * /home. The segment is deliberately absent from the expectation.
   */
  it("lands the new user on /home — a home space has no workspace shell", async () => {
    // ⚠ Not a literal path — that would be a FOURTH copy, passing after a repoint.
    const { redirectPath } = await completeOnboarding("user-1", {
      mcpConnected: true,
      name: "Acme",
    });
    expect(redirectPath).toBe(spaHomePath());
    // 🔒 AND NO SEGMENT RODE ALONG. /home is a ROOT route; prefixing it with the
    // container's segment gives a path that resolves to the SPA's catch-all.
    expect(redirectPath).not.toContain("a1b2c3d4e5f6");
  });

  it("⚠ a non-home space would still land on the workspace home page", async () => {
    // The `kind` check is what makes the rule readable as "a home space
    // lands on /home". Unreachable today — `renameHomeSpaceIfPlaceholder`
    // goes through `ensureHomeSpace` — and pinned so that the day
    // onboarding names a real workspace, the shell landing is already correct.
    vi.mocked(renameHomeSpaceIfPlaceholder).mockResolvedValue({
      id: "ws-1",
      slug: "acme",
      publicId: "a1b2c3d4e5f6",
      name: "Acme",
      kind: "standard",
    } as never);
    const { redirectPath } = await completeOnboarding("user-1", {
      mcpConnected: true,
    });
    expect(redirectPath).toBe(`/acme-a1b2c3d4e5f6/${spaWorkspaceHomePath()}`);
  });

  it("names an unnamed home space \"Home\", never after the user (Samuel, 2026-09-06)", async () => {
    // "<First>'s Workspace" was read by agents as a second workspace. The
    // home space is the default space, and its default name says so.
    await completeOnboarding("user-1", { mcpConnected: false });
    expect(renameHomeSpaceIfPlaceholder).toHaveBeenCalledWith(
      "user-1",
      "Home",
      undefined
    );
  });

  it("routes to a page the SPA actually has (not the catch-all)", async () => {
    // Correct-looking path is still "Not found" if no route serves it.
    // ⚠ /home is registered by the IMPORTED constant, not by a literal, so the
    // route table is checked for `path: HOME_PATH` — matching on the string
    // "/home" here would fail against a correct table and pass against a
    // hardcoded one, i.e. exactly backwards.
    const { redirectPath } = await completeOnboarding("user-1", {
      mcpConnected: false,
    });
    expect(redirectPath).toBe(spaHomePath());
    const src = readFileSync(ROUTES_TSX, "utf8");
    expect(src).toContain("path: HOME_PATH,");
    expect(src).toContain("HOME_PATH");
  });
});
