// @vitest-environment jsdom
/**
 * `/get-started?workspace={segment}` — WHERE AN INVITE ACCEPTED IN A BROWSER ENDS
 * (2026-09-10, the new-user flow).
 *
 * 🔒 **THE DEAD END THIS CLOSES.** The invite/join cards' only no-app link was
 * `/download`, a bare 307 to the dmg: the one audience that needs help got a file
 * and no instructions, and nothing had told them the app then needs a sign-in.
 * They now land here, and the SEGMENT rides so the trip ends on the workspace they
 * were invited to rather than on a bare app.
 *
 * ⚠ **TWO HALVES, AND EACH IS RED UNDER ITS OWN REVERT:** the param is READ (the
 * page hands the screen a `dopl://open/…` link), and it SURVIVES the sign-in bounce
 * (it used to send a flat `redirectTo=/get-started`, deleting the one value the
 * link exists to carry).
 *
 * ⚠ **AND IT IS VALIDATED, NOT TRUSTED.** `parseSegment` answers null without a
 * real 12-char publicId suffix and the URL is re-composed from the PARSED halves,
 * so nothing crafted reaches `dopl://open/`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveMacDownloadAsset: vi.fn(),
}));

vi.mock("@/shared/supabase/server", () => ({ getUser: mocks.getUser }));
vi.mock("@/shared/version/mac-download", () => ({
  resolveMacDownloadAsset: mocks.resolveMacDownloadAsset,
}));
// The screen portals onto layout-owned DOM and starts a download; neither is this
// page's decision, and both need a browser. Stubbed to the props it receives.
vi.mock("@/features/get-started", () => ({
  GetStartedScreen: (props: { asset: string | null; openLink?: string | null }) => (
    <div data-asset={props.asset ?? ""} data-open={props.openLink ?? ""} />
  ),
}));
vi.mock("@/features/get-started/get-started.css", () => ({}));
vi.mock("@/features/get-started/install-animation.css", () => ({}));

import GetStartedPage from "./page";

const SEGMENT = "acme-a1b2c3d4e5f6";

/** The rendered element's props, or the redirect message. */
async function outcome(
  query: Record<string, string | string[] | undefined> = {}
): Promise<{ open: string; asset: string } | string> {
  try {
    const el = (await GetStartedPage({
      searchParams: Promise.resolve(query),
    })) as { props: { openLink?: string | null; asset: string | null } };
    return {
      open: el.props.openLink ?? "",
      asset: el.props.asset ?? "",
    };
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ id: "user-1" });
  mocks.resolveMacDownloadAsset.mockResolvedValue("Dopl-1.29.0-arm64.dmg");
});

describe("the workspace the visit named", () => {
  it("🔒 becomes a dopl://open link the page hands the screen", async () => {
    expect(await outcome({ workspace: SEGMENT })).toEqual({
      open: `dopl://open/${SEGMENT}`,
      asset: "Dopl-1.29.0-arm64.dmg",
    });
  });

  it("is absent on a bare visit — the page is unchanged for its original audience", async () => {
    expect(await outcome()).toEqual({
      open: "",
      asset: "Dopl-1.29.0-arm64.dmg",
    });
  });

  it.each([
    ["a legacy slug-only segment", "acme"],
    ["a path traversal", "../../etc/passwd"],
    ["an absolute URL", "https://evil.example"],
    ["a second scheme", "javascript:alert(1)"],
    ["a repeated param (array)", ["acme-a1b2c3d4e5f6", "other"]],
  ])("refuses %s and degrades to the plain page", async (_label, value) => {
    const res = await outcome({ workspace: value });
    expect(res).toMatchObject({ open: "" });
  });

  it("⚠ the download is never gated on it — a bad segment must not cost the dmg", async () => {
    const res = await outcome({ workspace: "nope" });
    expect(res).toMatchObject({ asset: "Dopl-1.29.0-arm64.dmg" });
  });
});

describe("🔒 the sign-in bounce carries it", () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue(null);
  });

  it("keeps the workspace across /login — the one round trip the link must survive", async () => {
    // ⚠ THE HALF THAT WAS BROKEN AND SILENT. A first-time invitee is by
    // definition signed out, so a flat `redirectTo=/get-started` deleted the
    // segment for exactly the population it was added for (F-136's shape).
    expect(await outcome({ workspace: SEGMENT })).toBe(
      `REDIRECT:/login?redirectTo=${encodeURIComponent(
        `/get-started?workspace=${SEGMENT}`
      )}`
    );
  });

  it("bounces a bare visit to the plain landing, as before", async () => {
    expect(await outcome()).toBe(
      `REDIRECT:/login?redirectTo=${encodeURIComponent("/get-started")}`
    );
  });

  it("does not carry a segment it refused", async () => {
    expect(await outcome({ workspace: "https://evil.example" })).toBe(
      `REDIRECT:/login?redirectTo=${encodeURIComponent("/get-started")}`
    );
  });
});
