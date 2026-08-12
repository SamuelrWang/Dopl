// @vitest-environment jsdom
/**
 * THE HANDOFF, AND THE TWO WAYS IT CAN QUIETLY STOP WORKING.
 *
 * 1. THE LINK SHAPE. `dopl://open/{segment}` is read by
 *    `dopl-desktop-app/main/deep-link-target.js`, a hand-written grammar in
 *    another language in another process. Nothing type-checks that seam, so the
 *    exact string is pinned here and the desktop half pins the same string
 *    against its own parser (`dopl-desktop-app/test/deep-link-target.test.mjs`).
 *
 * 2. THE BUTTON. The auto-open is best effort — a browser may refuse a protocol
 *    launch that no user gesture asked for — so the ANCHOR is the contract. A
 *    change that left only the effect would pass on the author's machine and
 *    strand everyone whose browser is stricter.
 *
 * Plus the property that made this component necessary at all: nothing it
 * renders is an in-app web path, every one of which the retirement map 302s to
 * `/get-started`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DesktopHandoffPanel, JoinPendingPanel } from "./desktop-handoff-panel";

const WORKSPACE = { slug: "acme", publicId: "a1b2c3d4e5f6" };
const SEGMENT = "acme-a1b2c3d4e5f6";

/**
 * jsdom cannot perform a `dopl:` navigation and only logs that it did not, so
 * `window.location` is swapped for something that RECORDS the assignment.
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
