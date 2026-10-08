import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { installBridge } from "#/test-utils/bridge";
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

/** Same scaffolding as `ontology-panels.test.tsx`; split out for `max-lines`. */
const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("@/features/channels/components/channel-surface-standalone", () => ({
  StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
}));

beforeEach(() => {
  window.localStorage.clear();
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
 * THE PANE'S DEVICE MEMORY (`features/ontology/last-opened.ts`): leaving /home's
 * Ontology face and coming back — a fresh render is the same as a reload or a
 * restart — lands on the ontology and the face the operator left.
 */
describe("last-opened memory", () => {
  const stored = () =>
    JSON.parse(
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith("dopl.ontology.lastOpened:"))
        .map((k) => window.localStorage.getItem(k))[0] ?? "null"
    )?.d; // enveloped `{ v, d }` by `shared/lib/persisted-ui-state.ts`

  it("reopens the ontology last picked, not the first", async () => {
    renderHome();
    await openOntologyFace();
    await openOntologySwitcher();
    fireEvent.click(screen.getByRole("menuitem", { name: /Roster/ }));
    await waitFor(() => expect(stored()?.ontologyId).toBe(ROSTER_ID));

    cleanup();
    renderHome();
    await openOntologyFace();
    await screen.findByTitle("Switch ontology");
    expect(ontologyName()).toBe("Roster");
  });

  it("reopens the changelog when that is where the operator left", async () => {
    renderHome();
    await openOntologyFace();
    await openOntologyMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Changelog" }));
    await screen.findByText("Stage");
    await waitFor(() => expect(stored()?.face).toBe("changelog"));

    cleanup();
    renderHome();
    // Not `openOntologyFace`: it waits for the BOARD, and the board is not up.
    await screen.findByRole("tab", { name: "Overview" });
    fireEvent.click(screen.getByText("Ontology"));
    expect(await screen.findByText("Stage")).toBeInTheDocument();
    expect(screen.queryByTitle("Switch ontology")).toBeNull();
    expect(stored()?.ontologyId).toBe(PIPELINE_ID);
  });

  it("falls back to the first ontology when the remembered one is gone", async () => {
    // The harness boots as one user; seed every plausible bucket via a write.
    renderHome();
    await openOntologyFace();
    await screen.findByTitle("Switch ontology");
    const key = Object.keys(window.localStorage).find((k) =>
      k.startsWith("dopl.ontology.lastOpened:")
    )!;
    cleanup();
    window.localStorage.setItem(key, JSON.stringify({ ontologyId: "ontology-deleted" }));

    renderHome();
    await openOntologyFace();
    await screen.findByTitle("Switch ontology");
    expect(ontologyName()).toBe("Pipeline");
    await waitFor(() => expect(stored()?.ontologyId).toBe(PIPELINE_ID));
  });
});


/** /home's own face memory (`../home-memory.ts`): the tab survives a remount. */
describe("/home face memory", () => {
  it("reopens on the Ontology face after leaving /home on it", async () => {
    renderHome();
    await openOntologyFace();
    await waitFor(() =>
      expect(
        Object.keys(window.localStorage).some((k) => k.startsWith("dopl.home.lastFace:"))
      ).toBe(true)
    );

    cleanup();
    renderHome();
    // No tab click: the board is up because /home remembered the face.
    expect(await screen.findByTitle("Switch ontology")).toBeInTheDocument();
    expect(ontologyName()).toBe("Pipeline");
  });

  it("starts on the default face with no memory", async () => {
    renderHome();
    await screen.findByRole("tab", { name: "Overview" });
    expect(screen.queryByTitle("Switch ontology")).toBeNull();
  });
});
