// @vitest-environment jsdom
/**
 * Two ways the handoff quietly stops working:
 *
 * 1. ⚠ LINK SHAPE. `dopl://open/{segment}` is parsed by
 *    `dopl-desktop-app/main/deep-link-target.js` — another language, another
 *    process, nothing type-checks the seam. Exact string pinned here and
 *    against its own parser (`dopl-desktop-app/test/deep-link-target.test.mjs`).
 * 2. ⚠ THE BUTTON is the contract; auto-open is best effort (browsers refuse
 *    protocol launches with no user gesture). Effect-only would pass locally
 *    and strand stricter browsers.
 *
 * Plus: nothing rendered is an in-app web path (all 302 to `/get-started`).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DesktopHandoffPanel, JoinPendingPanel } from "./desktop-handoff-panel";

const WORKSPACE = { slug: "acme", publicId: "a1b2c3d4e5f6" };
const SEGMENT = "acme-a1b2c3d4e5f6";

/**
 * jsdom cannot perform a `dopl:` navigation, so `window.location` is swapped
 * for something that RECORDS the assignment.
 */
let navigated: string | null;
let realLocation: PropertyDescriptor | undefined;

beforeEach(() => {
  navigated = null;
  realLocation = Object.getOwnPropertyDescriptor(window, "location");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      set href(value: string) {
        navigated = value;
      },
      get href() {
        return navigated ?? "http://localhost/";
      },
    },
  });
});

afterEach(() => {
  cleanup();
  if (realLocation) Object.defineProperty(window, "location", realLocation);
});

describe("DesktopHandoffPanel", () => {
  it("offers the workspace's dopl://open link as a real, clickable anchor", () => {
    render(<DesktopHandoffPanel workspace={WORKSPACE} heading="You're in." />);
    expect(
      screen.getByRole("link", { name: "Open Dopl" }).getAttribute("href")
    ).toBe(`dopl://open/${SEGMENT}`);
  });

  it("ALSO attempts the launch itself — the anchor is the floor, not the ceiling", () => {
    render(<DesktopHandoffPanel workspace={WORKSPACE} heading="You're in." />);
    expect(navigated).toBe(`dopl://open/${SEGMENT}`);
  });

  it("says what happened, and offers the app to anyone who has not installed it", () => {
    render(
      <DesktopHandoffPanel workspace={WORKSPACE} heading="You've joined Acme." />
    );
    expect(screen.getByText("You've joined Acme.")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Download Dopl" }).getAttribute("href")
    ).toBe("/download");
  });

  it("renders NO in-app web path — only the deep link and the download route", () => {
    const { container } = render(
      <DesktopHandoffPanel workspace={WORKSPACE} heading="You're in." />
    );
    for (const anchor of container.querySelectorAll("a")) {
      const href = anchor.getAttribute("href") ?? "";
      expect(href === "/download" || href.startsWith("dopl://")).toBe(true);
    }
  });

  it("degrades to the bare verb rather than a malformed path", () => {
    // `requestJoin` answers `""` for a workspace it could not read back.
    render(
      <DesktopHandoffPanel workspace={{ slug: "", publicId: "" }} heading="In." />
    );
    expect(
      screen.getByRole("link", { name: "Open Dopl" }).getAttribute("href")
    ).toBe("dopl://open");
  });
});

describe("JoinPendingPanel", () => {
  it("gives NO deep link — there is no membership to open yet", () => {
    const { container } = render(<JoinPendingPanel heading="Request sent." />);
    for (const anchor of container.querySelectorAll("a")) {
      expect(anchor.getAttribute("href")).toBe("/download");
    }
  });

  it("says approval comes first and the app is where it lands", () => {
    render(<JoinPendingPanel heading="Request sent." />);
    expect(screen.getByText("Request sent.")).toBeDefined();
    expect(screen.getByText(/approve you before you can open/)).toBeDefined();
    expect(screen.getByText(/open the Dopl desktop app/)).toBeDefined();
  });
});
