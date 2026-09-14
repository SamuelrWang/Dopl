import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { bridgeCalls, installBridge } from "#/test-utils/bridge";
import { renderHome, routes } from "./home-test-harness";
import {
  PIPELINE_ID,
  ontologyRoutes,
  openOntologyFace,
  resetOntologyRoutes,
} from "./ontology-test-harness";

/**
 * **"+ Object" AND ITS POPUP**, on /home — its own file for the 500-line cap
 * (`ontology-panels.test.tsx` is the rest of this face, `ontology-rename.test.tsx`
 * the gear's Rename, and the twin assertions on `/[ws]/ontology` live in
 * `pages/ontology/index.test.tsx`).
 *
 * ⚠ **WHAT IS UNDER TEST IS WHAT LEAVES.** Samuel, 2026-09-11: *"what it's
 * supposed to do is create a new object type, basically a new column … right now
 * the code is messed up, where it's actually creating a new object on top of the
 * column"*, and *"If the user doesn't actually end up creating it, that little
 * thing disappears"*. So every case here reads the REQUEST LOG, not just the DOM:
 * the lane appearing proves nothing about what was sent for it.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED — `vi.mock` is hoisted per file and its
 * factory may not close over imports, so the stub is local (every /home suite
 * carries its own for this reason).
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

beforeEach(() => {
  resetOntologyRoutes();
  apiRequest.mockReset();
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}) =>
      ontologyRoutes(path, opts) ??
      routes(path, opts) ??
      Promise.reject(new Error(`unexpected: ${path}`))
  );
  installBridge({ apiRequest });
});

/**
 * Click "+ Object" and wait for the popup the click opens.
 *
 * ⚠ THE LANE AND THE POPUP BOTH SHOW "Untitled object", so a `findByDisplayValue`
 * on that string is AMBIGUOUS the moment the dialog mounts — and resolves against
 * whichever landed first, which is a race. The dialog is waited for by ROLE and
 * the lanes are read by their own label.
 */
async function openNewObjectPopup() {
  fireEvent.click(screen.getByRole("button", { name: "Object" }));
  return within(await screen.findByRole("dialog", { name: "New object" }));
}

/** Every lane header's name, in board order — the lanes' own field. */
function laneNames(): string[] {
  return screen
    .getAllByLabelText("Object name")
    .map((el) => (el as HTMLInputElement).value);
}

describe("+ Object", () => {
  /**
   * 🔒 **"+ Object" MAKES AN OBJECT TYPE — THE LANE** (Samuel, 2026-09-11: *"what
   * it's supposed to do is create a new object type, basically a new column …
   * right now the code is messed up, where it's actually creating a new object on
   * top of the column"*). It made a CARD in the first lane until this landed.
   *
   * ⚠ AND THE CLICK SENDS NOTHING: the lane appears and the popup opens over it,
   * so a create the operator abandons costs no row (`optimistic-create.ts ›
   * beginColumnDraft`).
   *
   * ⚠ MUTATION-VERIFIED — one revert, one failure: pointing the header button back
   * at `{ parentObjectId: firstColumn }` (the board still changes and the popup
   * assertion is the only thing that notices the button made a card).
   */
  it("appends the lane and opens the popup, POSTing nothing yet", async () => {
    renderHome();
    await openOntologyFace();
    await screen.findByText("Acme");

    const dialog = await openNewObjectPopup();

    // The lane is on the board, under its born name…
    expect(laneNames()).toContain("Untitled object");
    // …the popup is over it, with the name prefilled…
    expect(
      (dialog.getByLabelText("New object name") as HTMLInputElement).value
    ).toBe("Untitled object");
    // …and nothing has been sent for either.
    expect(
      bridgeCalls(apiRequest).filter(
        (c) => c.path === "/api/ontology/objects" && c.opts.method === "POST"
      )
    ).toHaveLength(0);
  });

  /**
   * 🔒 CREATE COMMITS THE LANE THAT IS ALREADY THERE — one POST for the name, one
   * PATCH for what the create schema cannot carry (the description and the
   * fields), and the lane stays.
   */
  it("POSTs the name and PATCHes description + fields on Create", async () => {
    renderHome();
    await openOntologyFace();
    await screen.findByText("Acme");
    const dialog = await openNewObjectPopup();
    fireEvent.change(dialog.getByLabelText("New object name"), {
      target: { value: "Deal" },
    });
    fireEvent.change(dialog.getByLabelText("New object description"), {
      target: { value: "One live opportunity" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Field" }));
    fireEvent.change(dialog.getByLabelText("Field"), {
      target: { value: "Owner" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const post = bridgeCalls(apiRequest).find(
        (c) => c.path === "/api/ontology/objects" && c.opts.method === "POST"
      );
      expect(post?.opts.body).toMatchObject({ clusterId: PIPELINE_ID, name: "Deal" });
    });
    await waitFor(() => {
      const patch = bridgeCalls(apiRequest).find(
        (c) =>
          c.path.startsWith("/api/ontology/objects/") && c.opts.method === "PATCH"
      );
      expect(patch?.opts.body).toMatchObject({
        subtitle: "One live opportunity",
        template: [{ key: "owner", label: "Owner", kind: "text" }],
      });
    });
    // The popup closed and the lane it filled in is still on the board.
    // ⚠ `waitFor`: `ModalShell` stays mounted through its exit transition.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New object" })).toBeNull()
    );
    expect(laneNames()).toContain("Deal");
  });

  /**
   * 🔒 **DISCARD TAKES THE LANE BACK OFF, AND LEAKS NOTHING** (Samuel: *"If the
   * user doesn't actually end up creating it, that little thing disappears"*).
   *
   * ⚠ MUTATION-VERIFIED — one revert, one failure: making `beginColumnDraft` POST
   * from the click (the lane still vanishes on Discard, and only the request log
   * shows a row left behind on the server).
   */
  it("removes the lane on Discard, with no POST and no DELETE", async () => {
    renderHome();
    await openOntologyFace();
    await screen.findByText("Acme");
    const dialog = await openNewObjectPopup();

    fireEvent.click(dialog.getByRole("button", { name: "Discard" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New object" })).toBeNull()
    );
    expect(laneNames()).not.toContain("Untitled object");
    expect(
      bridgeCalls(apiRequest).filter((c) =>
        c.path.startsWith("/api/ontology/objects")
      )
    ).toHaveLength(0);
  });

  it("treats Escape as Discard — same lane removal, same silence", async () => {
    renderHome();
    await openOntologyFace();
    await screen.findByText("Acme");
    await openNewObjectPopup();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New object" })).toBeNull()
    );
    expect(laneNames()).not.toContain("Untitled object");
    expect(
      bridgeCalls(apiRequest).filter((c) =>
        c.path.startsWith("/api/ontology/objects")
      )
    ).toHaveLength(0);
  });

});
