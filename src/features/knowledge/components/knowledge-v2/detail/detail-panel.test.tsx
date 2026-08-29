// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeBase, KnowledgeEntry } from "../../../types";
import type { Selection } from "../types";
import { DetailPanel } from "./detail-panel";

/**
 * THE DETAIL COLUMN'S TWO FACES AND THE FADE BETWEEN THEM.
 *
 * ⚠ THE DOCUMENT IS STUBBED, DELIBERATELY. `FileView` mounts a live TipTap
 * editor; what is under test is which FACE is on screen for a given selection
 * and WHAT THE OUTGOING ONE STILL HOLDS mid-fade — DetailPanel's own logic.
 * The stub prints the id it was handed a body for, which is the whole question
 * the `lastEntry` latch exists to answer.
 *
 * ⚠ THE INFO FACE IS NOT STUBBED, because "info is the resting state" is an
 * assertion about the real section, not about a placeholder.
 */

vi.mock("./file-view", () => ({
  FileView: ({ fullEntry }: { fullEntry: KnowledgeEntry | null }) => (
    <div data-testid="file-face">{fullEntry ? fullEntry.title : "no-body"}</div>
  ),
}));

afterEach(cleanup);

const BASE = {
  id: "kb-1",
  slug: "specs",
  name: "Product specs",
  description: "What we ship",
  visibility: "private",
  accessMode: "workspace",
  createdBy: "u-me",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
} as KnowledgeBase;

function entry(id: string, title: string): KnowledgeEntry {
  return {
    id,
    title,
    folderId: null,
    position: 0,
    body: "<p>x</p>",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as KnowledgeEntry;
}

const A = entry("e-a", "Cold outreach");
const B = entry("e-b", "Discovery call");

function renderPane(
  selection: Selection,
  openEntry: KnowledgeEntry | null = null
) {
  return render(
    <DetailPanel
      selection={selection}
      workspaceId="ws-1"
      selectedTree={{ status: "ready", folders: [], entries: [A, B] }}
      openEntry={openEntry}
      openEntryStatus={openEntry ? "success" : "loading"}
      refetchOpenEntry={() => {}}
      canEditBase
      onTreeRefresh={() => {}}
      onBaseSaved={() => {}}
    />
  );
}

const baseSel: Selection = { kind: "base", base: BASE };
const fileSel = (e: KnowledgeEntry): Selection => ({
  kind: "entry",
  base: BASE,
  entry: e,
});

describe("the detail column's resting state", () => {
  it("opens on the base's INFO face, not on an empty 'pick a file' pane", () => {
    renderPane(baseSel);
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("Contents")).toBeTruthy();
    expect(screen.getByDisplayValue("Product specs")).toBeTruthy();
    expect(screen.queryByTestId("file-face")).toBeNull();
  });

  it("🔒 states the base's OWN dates on the info face", () => {
    // A base selection must not read an entry's timestamps: the face is built
    // from a base-kind view model, never from whatever the selection happens
    // to be while a fade is in flight.
    renderPane(baseSel);
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("Owner only")).toBeTruthy();
  });

  it("mounts the shared fade surface, settled, around whichever face shows", () => {
    const { container } = renderPane(baseSel);
    const fade = container.querySelector(".crossfade");
    expect(fade).not.toBeNull();
    // Settled = no `data-out`, no `aria-busy`: the kit's `.crossfade` is what
    // animates, and a resting pane must not sit at opacity 0.
    expect(fade?.hasAttribute("data-out")).toBe(false);
    expect(fade?.getAttribute("aria-busy")).toBeNull();
  });
});

describe("the fade between the faces", () => {
  it("keeps the INFO face on screen while the file is fading in", () => {
    const { rerender, container } = renderPane(baseSel);
    rerender(
      <DetailPanel
        selection={fileSel(A)}
        workspaceId="ws-1"
        selectedTree={{ status: "ready", folders: [], entries: [A, B] }}
        openEntry={A}
        openEntryStatus="success"
        refetchOpenEntry={() => {}}
        canEditBase
        onTreeRefresh={() => {}}
        onBaseSaved={() => {}}
      />
    );

    // ⚠ THE OUTGOING FACE IS STILL MOUNTED — that IS the fade
    // (`shared/ui/crossfade.tsx`: 150ms, the token lags the selection).
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.queryByTestId("file-face")).toBeNull();
    const fade = container.querySelector(".crossfade");
    expect(fade?.hasAttribute("data-out")).toBe(true);
    expect(fade?.getAttribute("aria-busy")).toBe("true");
  });

  it("🔒 the outgoing FILE keeps its document while the info face fades in", () => {
    // 🔒 THE `lastEntry` LATCH. Leaving a file nulls `openEntry` immediately,
    // so without the latch the document that is fading OUT would blink into a
    // loading skeleton on its way off screen — a face nobody navigated to.
    const props = {
      workspaceId: "ws-1",
      selectedTree: { status: "ready" as const, folders: [], entries: [A, B] },
      refetchOpenEntry: () => {},
      canEditBase: true,
      onTreeRefresh: () => {},
      onBaseSaved: () => {},
    };
    const { rerender } = render(
      <DetailPanel
        {...props}
        selection={fileSel(A)}
        openEntry={A}
        openEntryStatus="success"
      />
    );
    expect(screen.getByTestId("file-face").textContent).toBe("Cold outreach");

    rerender(
      <DetailPanel
        {...props}
        selection={baseSel}
        openEntry={null}
        openEntryStatus="idle"
      />
    );
    expect(screen.getByTestId("file-face").textContent).toBe("Cold outreach");
  });

  it("🔒 never shows one file's body under another file's name", () => {
    // The latch answers for the token it NAMES and no other. Switching files
    // before B's body lands must show B as loading, not A's document wearing
    // B's identity.
    const props = {
      workspaceId: "ws-1",
      selectedTree: { status: "ready" as const, folders: [], entries: [A, B] },
      refetchOpenEntry: () => {},
      canEditBase: true,
      onTreeRefresh: () => {},
      onBaseSaved: () => {},
    };
    const { rerender } = render(
      <DetailPanel
        {...props}
        selection={fileSel(A)}
        openEntry={A}
        openEntryStatus="success"
      />
    );
    // A → B with B's fetch still out. The SHOWN token is still A's, so A is
    // what stays; the swap to B happens a fade later.
    rerender(
      <DetailPanel
        {...props}
        selection={fileSel(B)}
        openEntry={null}
        openEntryStatus="loading"
      />
    );
    expect(screen.getByTestId("file-face").textContent).toBe("Cold outreach");
    expect(screen.getByTestId("file-face").textContent).not.toBe("Discovery call");
  });
});
