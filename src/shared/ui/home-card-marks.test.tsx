// @vitest-environment jsdom
/**
 * ONE IMPLEMENTATION PER MARK — the channel row's dot, its `@ N` pill and its
 * "Link out" chip (Wave 4, R-03/R-28).
 *
 * ⚠ **THE SUITE IS ABOUT WHERE THE MARKS ARE DECLARED, NOT WHAT THEY LOOK LIKE.**
 * Both channel rows — /home's card and the workspace picker's 36px line — draw
 * the same three facts, and until Wave 4 the dot was cut twice and the chip was
 * inline markup on one host. Two declarations is how a restyle lands on whichever
 * file the next reader opened, which is the defect `page-action-button.ts` was
 * extracted to fix.
 *
 * ⚠ **TWO INKS IS NOT TWO IMPLEMENTATIONS.** R-03 keeps the workspace picker's
 * own design, so the dot stays blue there and ink on /home; what the module owns
 * is the geometry, the accessible name and the precedence.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { LinkOutChip, MentionBadge, UnreadDot } from "./home-card-marks";

afterEach(cleanup);

const dot = () => screen.getByLabelText("Unread messages");

describe("UnreadDot — one shape, the surface's own ink", () => {
  it("is ink on /home", () => {
    render(<UnreadDot />);
    expect(dot().className).toContain("bg-text-primary");
  });

  it("is the picker's blue under `tone=\"link\"` (R-03)", () => {
    render(<UnreadDot tone="link" />);
    expect(dot().className).toContain("bg-link");
  });

  // The face the dot stands on decides before the surface's accent does: the
  // selected /home row IS the black button, and ink on ink is invisible.
  it("lets `onDark` outrank the tone", () => {
    render(<UnreadDot tone="link" onDark />);
    expect(dot().className).toContain("bg-text-on-cta");
    expect(dot().className).not.toContain("bg-link");
  });

  it("carries the accessible name itself, so no caller has to spell it", () => {
    render(<UnreadDot />);
    expect(dot()).toBeTruthy();
  });
});

describe("LinkOutChip — a STATE of the row, never a control", () => {
  it("says the fact in the app's three words", () => {
    render(<LinkOutChip />);
    expect(screen.getByText("Link out")).toBeTruthy();
  });

  // Minting and revoking a link are the record pane's. A chip that looked
  // clickable here would be a dead control (INVARIANTS §5).
  it("offers no button", () => {
    render(<LinkOutChip />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("inverts on the selected black card rather than vanishing", () => {
    render(<LinkOutChip onDark />);
    expect(screen.getByText("Link out").className).toContain("text-text-on-cta");
  });
});

describe("MentionBadge stays hidden at zero", () => {
  it("draws no `@ 0`", () => {
    const { container } = render(<MentionBadge count={0} />);
    expect(container.textContent).toBe("");
  });
});

/**
 * 🔒 **THE ABSENCE IS THE ASSERTION.** Re-cutting a 6px dot is three lines and
 * compiles everywhere; nothing else goes red when a second one appears, and the
 * two then drift apart a ruling at a time — which is exactly what happened to
 * this dot between 2026-08-19 and Wave 4.
 */
describe("🔒 the unread dot is declared in exactly ONE file", () => {
  const ROOTS = ["src/shared/ui", "src/features/channels/components"];
  const ALLOWED = "home-card-marks.tsx";

  it("no other row file names the dot's accessible label outside a comment", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of readdirSync(root)) {
        if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
        if (file === ALLOWED) continue;
        readFileSync(join(root, file), "utf8")
          .split("\n")
          .forEach((line, i) => {
            const code = line.trim();
            if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) {
              return;
            }
            if (/Unread messages/.test(code)) offenders.push(`${root}/${file}:${i + 1}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
