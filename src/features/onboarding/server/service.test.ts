/**
 * ⚠ DRIFT ALARM. `completeOnboarding` lands a new user on the SPA's ROOT
 * `HOME_PATH` (onboarding names a `kind='home'` container, which has no workspace
 * shell); `WORKSPACE_HOME_PATH` is pinned only for the non-home fallback branch.
 *
 * Sources: `HOME_PATH` — `apps/desktop-ui/src/components/app-shell/account-rail.tsx`
 * (root route in `routes.tsx`; copies in `dopl-desktop-app/main/deep-link-target.js`
 * › ROOT_ROUTES and `./service.ts` › completeOnboarding). `WORKSPACE_HOME_PATH` —
 * `apps/desktop-ui/src/routes.tsx` (copies in `routes.test.tsx`, `deep-link-target.js`
 * › WORKSPACE_HOME_PAGE).
 *
 * A repoint would drop new users on "Not found" with the suite green. Server code
 * can't import the SPA's constants, so read the source and compare.
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
    // ⚠ `kind` is what the landing branches on; the real function only answers home.
    kind: "home",
  } as never);
  vi.mocked(markOnboarded).mockResolvedValue(false);
});

describe("completeOnboarding redirect target", () => {
  /**
   * 🔒 New user lands on `/home`, not the workspace shell (2026-09-10): a
   * `kind='home'` container is a SHELF (`20260920120000`'s header) whose surface
   * is /home. The segment is deliberately absent.
   */
  it("lands the new user on /home — a home space has no workspace shell", async () => {
    // ⚠ Not a literal path — that would be a fourth copy, passing after a repoint.
    const { redirectPath } = await completeOnboarding("user-1", {
      mcpConnected: true,
      name: "Acme",
    });
    expect(redirectPath).toBe(spaHomePath());
    // 🔒 No segment: /home is a ROOT route; a prefix hits the SPA's catch-all.
    expect(redirectPath).not.toContain("a1b2c3d4e5f6");
  });

  it("⚠ a non-home space would still land on the workspace home page", async () => {
    // Unreachable today (`renameHomeSpaceIfPlaceholder` goes through
    // `ensureHomeSpace`); pinned so a future real-workspace landing is correct.
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
    // "<First>'s Workspace" was read by agents as a second workspace.
    await completeOnboarding("user-1", { mcpConnected: false });
    expect(renameHomeSpaceIfPlaceholder).toHaveBeenCalledWith(
      "user-1",
      "Home",
      undefined
    );
  });

  it("routes to a page the SPA actually has (not the catch-all)", async () => {
    // ⚠ The route table registers the IMPORTED constant, so check for
    // `path: HOME_PATH` — matching the literal "/home" would be exactly backwards.
    const { redirectPath } = await completeOnboarding("user-1", {
      mcpConnected: false,
    });
    expect(redirectPath).toBe(spaHomePath());
    const src = readFileSync(ROUTES_TSX, "utf8");
    expect(src).toContain("path: HOME_PATH,");
    expect(src).toContain("HOME_PATH");
  });
});
