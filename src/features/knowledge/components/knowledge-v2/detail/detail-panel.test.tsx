// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeBase, KnowledgeEntry } from "../../../types";
import type { Selection } from "../types";
import { DetailPanel } from "./detail-panel";

/**
 * The detail column's two faces and the fade between them.
 *
 * The document is stubbed deliberately: `FileView` mounts a live TipTap editor,
 * and what is under test is which face is on screen for a given selection and
 * what the outgoing one still holds mid-fade. The stub prints the id it was
 * handed a body for, which is what the `lastEntry` latch exists to answer. The
 * info face is not stubbed, because "info is the resting state" is an assertion
 * about the real section.
 *
 * Since 2026-09-09 it mounts the changelog, a live query, so every render is
 * wrapped in a `QueryClientProvider` and the changelog's client modules are
 * stubbed; the changelog has its own suite.
 */

// The whole module, not the two knowledge fetchers: `revisions/client/hooks.ts`
// builds one fetcher map over every family, so a partial mock leaves an
// `undefined` in it and the module fails at import.
vi.mock("@/features/revisions/client/api", () => ({
  fetchEntryRevisions: vi.fn(async () => ({ revisions: [], nextCursor: null })),
  fetchBaseRevisions: vi.fn(async () => ({ revisions: [], nextCursor: null })),
  fetchOntologyObjectRevisions: vi.fn(async () => ({ revisions: [], nextCursor: null })),
  fetchOntologyClusterRevisions: vi.fn(async () => ({ revisions: [], nextCursor: null })),
  restoreEntryRevision: vi.fn(),
  restoreOntologyObjectRevision: vi.fn(),
}));

vi.mock("./file-view", () => ({
  FileView: ({ fullEntry }: { fullEntry: KnowledgeEntry | null }) => (
    <div data-testid="file-face">{fullEntry ? fullEntry.title : "no-body"}</div>
  ),
}));

afterEach(cleanup);

/** A fresh client per render: a shared cache would let one test's changelog
 *  answer another's. */
function withQuery({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

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
      openEntry={openEntry}
      openEntryStatus={openEntry ? "success" : "loading"}
      refetchOpenEntry={() => {}}
      canEditBase
      onTreeRefresh={() => {}}
      onBaseSaved={() => {}}
    />,
    { wrapper: withQuery }
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
    // "Changelog", not "Contents": the base info face's second flat section is
    // the day-grouped roll-up.
    expect(screen.getByText("Changelog")).toBeTruthy();
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
          openEntry={A}
        openEntryStatus="success"
        refetchOpenEntry={() => {}}
        canEditBase
        onTreeRefresh={() => {}}
        onBaseSaved={() => {}}
      />
    );

    // The outgoing face is still mounted — that is the fade
    // (`shared/ui/crossfade.tsx`: 150ms, the token lags the selection).
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.queryByTestId("file-face")).toBeNull();
    const fade = container.querySelector(".crossfade");
    expect(fade?.hasAttribute("data-out")).toBe(true);
    expect(fade?.getAttribute("aria-busy")).toBe("true");
  });

  it("🔒 the outgoing FILE keeps its document while the info face fades in", () => {
    // The `lastEntry` latch: leaving a file nulls `openEntry` immediately, so
    // without it the document fading out blinks into a loading skeleton.
    const props = {
      workspaceId: "ws-1",
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
      />,
      { wrapper: withQuery }
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
      />,
      { wrapper: withQuery }
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
