import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { installBridge } from "#/test-utils/bridge";
import {
  openChannelRecord,
  renderHome, routes,
} from "./home-test-harness";

/**
 * 🔒 /home → KNOWLEDGE → AN **OPENED** BASE. Samuel's ruling 2026-08-28, over a
 * screenshot: *a mess of mismatched components, double-panelled, stray
 * hairlines.*
 *
 * ⚠ ITS OWN FILE BECAUSE IT IS ITS OWN SUBJECT — the same seam
 * `knowledge-panels-shelf.test.tsx` was cut on, and the same honest footnote:
 * the split happened NOW because `knowledge-panels.test.tsx` crossed the
 * 500-line cap. Next door asks which SECTION lists what; this file asks what an
 * opened base looks like, which is a different surface reached through the
 * panels rather than a behaviour of them.
 *
 * ⚠ MOUNTED THROUGH `HomePage`, NEVER THE VIEW. The whole subject is the
 * RELATIONSHIP between two surfaces — a view that paints its own page float and
 * a host that already is one — so a direct mount of `HomeKnowledgeBaseView`
 * would pass with the defect fully present.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED, and `vi.mock` is hoisted per FILE — which
 * is why this bootstrap is restated here rather than shared from the harness.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channels-v2/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}) =>
      routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`))
  );
  installBridge({ apiRequest });
});

/** Open the Knowledge face through the header control the operator clicks. */
async function openKnowledge(): Promise<void> {
  await openChannelRecord();
  fireEvent.click(screen.getByText("Knowledge"));
}

describe("🔒 the opened base — ONE panel, info at rest", () => {
  /**
   * 🔒 SAMUEL'S RULING, 2026-08-28, over a screenshot of this surface: "kill
   * the double panel". The knowledge view's own default surface is
   * `.page-float` — THE full-page card, of which the kit allows exactly one per
   * page (docs/DESIGN-SYSTEM.md › Patterns) — and /home mounts that view INSIDE
   * the record pane, which is already a bordered card on a panel. The fix is
   * `knowledge-v2.tsx › Props.embedded`, threaded from `knowledge-base-view.tsx`.
   *
   * ⚠ THE PIN IS A COUNT WITH AN IDENTITY, not a `not.toContain`. /home's own
   * `<main>` IS a `.page-float` and must stay one; what may not exist is a
   * SECOND one nested inside it. Asserting only the absence of the class would
   * go green the day the page surface itself was lost.
   *
   * ⚠ MUTATION-VERIFIED: dropping `embedded` in `knowledge-base-view.tsx`
   * turns the first assertion red (2 floats), and dropping the info face's
   * `SectionPanel`s turns the second red.
   */
  async function openFundraiseMemos(): Promise<void> {
    renderHome();
    await openKnowledge();
    fireEvent.click(await screen.findByText("Fundraise memos"));
    // The header's crumb is the last thing the detail surface paints.
    await screen.findByLabelText("Knowledge base breadcrumb");
  }

  it("🔒 adds NO second page surface inside the record pane", async () => {
    await openFundraiseMemos();

    const floats = document.querySelectorAll(".page-float");
    expect(floats).toHaveLength(1);
    expect(floats[0].tagName).toBe("MAIN");
  });

  it("rests on the base's INFO face, with the tree in a collapsible rail", async () => {
    await openFundraiseMemos();

    // The resting state is the base's own page — not a "pick a file" prompt.
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Contents")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Fundraise memos")).toBeInTheDocument();

    // …and the rail is a column of its own, with its own collapse control.
    const toggle = screen.getByRole("button", { name: "Hide files" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: "Show files" })
    ).toBeInTheDocument();
  });

  it("carries ONE breadcrumb for the whole panel", async () => {
    await openFundraiseMemos();
    // It was two navs — the rail's `Knowledge › {base}` and the detail pane's
    // `{base} › {folder} › {file}` — on screen together.
    expect(
      screen.getAllByLabelText("Knowledge base breadcrumb")
    ).toHaveLength(1);
  });
});

