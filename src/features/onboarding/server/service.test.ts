/**
 * ⚠ DRIFT ALARM — `WORKSPACE_HOME_PATH` is hand-copied in 3 places. Source of
 * truth: `apps/desktop-ui/src/routes.tsx`. Other copies + their alarms:
 * `apps/desktop-ui/src/routes.test.tsx` (pins the constant),
 * `dopl-desktop-app/main/deep-link-target.js` › WORKSPACE_HOME_PAGE, and
 * `./service.ts` › completeOnboarding (the hardcoded "/overview" this pins).
 * Repointing the SPA home would drop every newly onboarded user on "Not found"
 * with the suite green.
 *
 * Server code cannot IMPORT the constant (different npm workspace, `#/`
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
  PERSONAL_CONTAINER_DEFAULT_NAME: "Home",
  renamePersonalContainerIfPlaceholder: vi.fn(),
}));
vi.mock("./repository", () => ({
  findDisplayName: vi.fn(),
  findOnboardedAt: vi.fn(),
  hasActiveMcpToken: vi.fn(),
  markOnboarded: vi.fn(),
}));

import { renamePersonalContainerIfPlaceholder } from "@/features/workspaces/server/service";
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
  vi.mocked(renamePersonalContainerIfPlaceholder).mockResolvedValue({
    id: "ws-1",
    slug: "acme",
    publicId: "a1b2c3d4e5f6",
    name: "Acme",
  } as never);
  vi.mocked(markOnboarded).mockResolvedValue(false);
});

describe("completeOnboarding redirect target", () => {
  it("lands the new user on the SPA's real workspace home page", async () => {
    // ⚠ Not a literal path — that would be a FOURTH copy, passing after a repoint.
    const { redirectPath } = await completeOnboarding("user-1", {
      mcpConnected: true,
      name: "Acme",
    });
    expect(redirectPath).toBe(`/acme-a1b2c3d4e5f6/${spaWorkspaceHomePath()}`);
  });

  it("names an unnamed home space \"Home\", never after the user (Samuel, 2026-09-06)", async () => {
    // "<First>'s Workspace" was read by agents as a second workspace. The
    // personal container is the default space, and its default name says so.
    await completeOnboarding("user-1", { mcpConnected: false });
    expect(renamePersonalContainerIfPlaceholder).toHaveBeenCalledWith(
      "user-1",
      "Home",
      undefined
    );
  });

  it("routes to a page the SPA actually has (not the catch-all)", async () => {
    // Correct-looking path is still "Not found" if no route serves it.
    const { redirectPath } = await completeOnboarding("user-1", {
      mcpConnected: false,
    });
    const page = redirectPath.split("/").slice(2).join("/");
    const src = readFileSync(ROUTES_TSX, "utf8");
    expect(src).toContain(`{ path: "${page}",`);
  });
});
