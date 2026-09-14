import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { bridgeCalls, installBridge } from "#/test-utils/bridge";
import { renderHome, routes } from "./home-test-harness";
import {
  PIPELINE_ID,
  ROSTER_ID,
  ontologyName,
  ontologyRoutes,
  openOntologyFace,
  openOntologyMenu,
  openOntologySwitcher,
  resetOntologyRoutes,
} from "./ontology-test-harness";

/**
 * THE BOARD HEADER'S **GEAR MENU AND ITS RENAME**, on /home — its own file for
 * the 500-line cap
 * (`ontology-panels.test.tsx` is the rest of this face, and the twin assertions
 * on `/[ws]/ontology` live in `pages/ontology/index.test.tsx`).
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
 * EVERY /home CONTROL, ONE PLACE EACH — the four the card's pill row carried
 * before the restyle, re-homed into the header's GEAR (it was a `…` for one day).
 */
describe("the controls", () => {
  it("reaches Share, Changelog, both agent rungs and Delete from the GEAR", async () => {
    renderHome();
    await openOntologyFace();
    // 🔒 A CIRCLE WITH A SETTINGS ICON, not the old `…` (Samuel, 2026-09-10) — and
    // 36px, the black button's own height beside it.
    const gear = await screen.findByRole("button", { name: "Settings for Pipeline" });
    expect(gear.className).toMatch(/rounded-full/);
    expect(gear.className).toMatch(/h-9/);
    expect(gear.className).toMatch(/w-9/);
    await openOntologyMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Share" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Changelog" })).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Agents can view" })
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Agents can edit" })
    ).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    // 🔒 **ONE DELETE SLOT** (2026-09-10): the board grew an `onDelete` row when
    // the workspace page's standalone trash was deleted, and /home must NOT get
    // both — the host's is the one that names the channels (Q4).
    expect(within(menu).getAllByRole("menuitem", { name: "Delete" })).toHaveLength(1);
    // …and Rename is the board's own row, above "+ Column".
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
  });

  it("writes the agents rung to the CLUSTER's own PATCH", async () => {
    renderHome();
    await openOntologyFace();
    await openOntologySwitcher();
    fireEvent.click(screen.getByRole("menuitem", { name: /Roster/ }));
    await waitFor(() => expect(ontologyName()).toBe("Roster"));

    await openOntologyMenu("Roster");
    fireEvent.click(screen.getByRole("menuitem", { name: "Agents can view" }));

    await waitFor(() => {
      const patch = bridgeCalls(apiRequest).find(
        (c) =>
          c.path === `/api/ontology/clusters/${ROSTER_ID}` &&
          c.opts.method === "PATCH"
      );
      expect(patch?.opts.body).toEqual({ agentsMayEdit: false });
    });
  });

  it("opens the share popup for the ontology on the board", async () => {
    renderHome();
    await openOntologyFace();
    await openOntologyMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));

    expect(
      await screen.findByRole("dialog", { name: /Share Pipeline/i })
    ).toBeInTheDocument();
  });

  it("opens the delete confirm, which is the one that NAMES the channels", async () => {
    renderHome();
    await openOntologyFace();
    await openOntologyMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(await screen.findByText(/unshares it from/)).toBeInTheDocument();
  });
});

describe("what this face deliberately does not do", () => {
  it("does not read the CHANNEL's container — the rows are personal", async () => {
    renderHome();
    await openOntologyFace();

    const shares = bridgeCalls(apiRequest).filter((c) =>
      c.path.includes("/shares")
    );
    // ⚠ NO SHARE READ ON FIRST PAINT. The board's own header says nothing about
    // sharing; the per-cluster read is the DIALOG's.
    expect(shares).toHaveLength(0);
    expect(PIPELINE_ID).toBe("cluster-pipeline");
  });
});

/**
 * 🔒 **RENAMING, WHICH ONLY THE GEAR OFFERS** (2026-09-10). Making the name the
 * switcher's TRIGGER deleted the inline name input, and with it every way to
 * rename an ontology from the board; this is the way back.
 *
 * ⚠ MUTATION-VERIFIED — one revert, one failure HERE and one on the twin suite
 * (`pages/ontology/index.test.tsx`, same header): dropping the `name` key from
 * `NameField`'s `onCommit` dispatch in `ontology-view.tsx`. The field closes and
 * the menu row still works — only the header's own words and the PATCH body say
 * the keystrokes went nowhere.
 */
describe("renaming", () => {
  async function startRename(): Promise<HTMLInputElement> {
    renderHome();
    await openOntologyFace();
    await openOntologyMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    return screen.getByLabelText("Name") as HTMLInputElement;
  }

  it("swaps the dropdown trigger for the kit's underline field, prefilled and focused", async () => {
    const field = await startRename();

    expect(field.value).toBe("Pipeline");
    expect(document.activeElement).toBe(field);
    // 🔒 ONE RECIPE WITH THE DESCRIPTION BESIDE IT — `.line` + `.input` from
    // `shared/ui/form-dialog.module.css`, black while editing.
    expect(field.className).toMatch(/input/);
    expect(field.parentElement?.className).toMatch(/line/);
    expect(field.parentElement?.className).toMatch(/lineActive/);
    // 🔒 THE CHEVRON GOES WITH THE TRIGGER IT BELONGS TO, not hidden separately.
    expect(screen.queryByTitle("Switch ontology")).toBeNull();
  });

  it("PATCHes the cluster's name on Enter", async () => {
    const field = await startRename();

    fireEvent.change(field, { target: { value: "Deal flow" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(ontologyName()).toBe("Deal flow"));
    await waitFor(
      () => {
        const patch = bridgeCalls(apiRequest).find(
          (c) =>
            c.path === `/api/ontology/clusters/${PIPELINE_ID}` &&
            c.opts.method === "PATCH"
        );
        expect(patch?.opts.body).toMatchObject({ name: "Deal flow" });
      },
      { timeout: 3000 }
    );
  });

  it("cancels on Escape, and writes NOTHING", async () => {
    const field = await startRename();

    fireEvent.change(field, { target: { value: "Nope" } });
    fireEvent.keyDown(field, { key: "Escape" });

    await screen.findByTitle("Switch ontology");
    expect(ontologyName()).toBe("Pipeline");
    expect(
      bridgeCalls(apiRequest).some(
        (c) =>
          c.path === `/api/ontology/clusters/${PIPELINE_ID}` &&
          c.opts.method === "PATCH"
      )
    ).toBe(false);
  });

  it("treats an emptied field as a cancel — never a rename to \"\"", async () => {
    const field = await startRename();

    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.blur(field);

    await screen.findByTitle("Switch ontology");
    expect(ontologyName()).toBe("Pipeline");
  });
});
