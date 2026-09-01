import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import {
  WORKSPACE_ID,
  bridgeCalls,
  installBridge,
} from "#/test-utils/bridge";
import {
  openChannelRecord,
  renderHome, routes,
} from "./home-test-harness";

/**
 * 🔒 /home → KNOWLEDGE, SCOPE C IS A **SHELF** — Samuel's ruling 2026-08-26,
 * schema `20260831120000_knowledge_base_home_scoped.sql`.
 *
 * ⚠ ITS OWN FILE because it is its own SUBJECT, not because
 * `knowledge-panels.test.tsx` hit the 500-line cap (it did; that is why the
 * split happened NOW rather than later). Everything here asks one question:
 * does "across all channels" list ONLY what was created from this pane? The
 * scope MECHANICS — which section renders what, the pill's pending state, the
 * empty sentences — stay next door.
 *
 * ⚠ AND IT IS NOT A CROSS-WORKSPACE LEAK SUITE. Measured in production
 * 2026-08-26: the bases Samuel reported really did live in his own default
 * standard workspace and every workspace gate held. The RANGE was the defect.
 * `home-test-harness.tsx › KB_WORKSPACE_SHELF` is that bug as a fixture.
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

describe("the home shelf", () => {
  it("shows the HOME SHELF and leaves the rest of that workspace out", async () => {
    // 🔒 SAMUEL'S RULING, 2026-08-26. `Dopl GTM` sits in the SAME workspace as
    // `Fundraise memos`, also private, also the caller's own — only
    // `?shelf=home` separates them, and the harness answers BOTH shelves when
    // the param is missing (`home-test-harness.tsx › knowledgeBases`).
    // ⚠ NOT A CROSS-WORKSPACE LEAK PIN AND NEVER WAS: measured in production
    // 2026-08-26, those bases really did live in the caller's home workspace.
    // The defect was the RANGE, not a gate.
    renderHome();
    await openKnowledge();

    expect(await screen.findByText("Fundraise memos")).toBeInTheDocument();
    expect(screen.queryByText("Dopl GTM")).not.toBeInTheDocument();
  });

  it("keeps the workspace shelf out even once the DETAIL mount has warmed the unfiltered list", async () => {
    // 🔴 THE VACUOUS-PIN GUARD, and the warm cache is reachable from this very
    // pane. Opening a scope-C base mounts `KnowledgeV2PreviewCore`, whose
    // controller runs a live base-list query of its own — forget the shelf
    // there and it warms `["knowledge", "bases:<ws>"]` with BOTH shelves, which
    // a plain-segment pane would then render with no request at all. The test
    // above cannot catch that: nothing has warmed the entry yet.
    renderHome();
    await openKnowledge();

    // Into the detail mount…
    fireEvent.click(await screen.findByText("Fundraise memos"));
    await screen.findByLabelText("Knowledge base breadcrumb");
    // …and back out to the grid.
    fireEvent.click(
      within(screen.getByLabelText("Knowledge base breadcrumb")).getByRole(
        "button",
        { name: "Knowledge" }
      )
    );

    await screen.findByText("Fundraise memos");
    expect(screen.queryByText("Dopl GTM")).not.toBeInTheDocument();
    // ⚠ AND NO READ MAY HAVE ASKED FOR BOTH SHELVES — a rendered-absent
    // assertion alone passes on a list that arrived wide and was filtered
    // client-side, which is the thing this repo does not do (§11). Matched on
    // the LIST path EXACTLY: `startsWith` also catches `/<id>/tree`.
    const wide = bridgeCalls(apiRequest).filter(
      (c) =>
        c.path.split("?")[0] === "/api/knowledge/bases" &&
        c.opts.workspaceId === WORKSPACE_ID &&
        !c.path.includes("shelf=")
    );
    expect(wide).toEqual([]);
  });});
