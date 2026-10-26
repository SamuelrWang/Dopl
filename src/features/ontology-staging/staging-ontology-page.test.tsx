// @vitest-environment jsdom
/**
 * The playground mounts the PRODUCT face over the staging server: the board, the object panel and
 * the scenario switch all run through the real hooks, and nothing reaches the network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StagingOntologyPage } from "./staging-ontology-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderPage() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as never;
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  render(<StagingOntologyPage />);
  return fetchSpy;
}

describe("the ontology playground", () => {
  it("renders the product board from the staging server, without fetching", async () => {
    const fetchSpy = renderPage();
    expect(await screen.findByTitle("Switch ontology", undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByTitle("Switch ontology").textContent).toBe("Sales pipeline");
    expect(await screen.findByText("Northwind Traders")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens the product object panel on a card", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Northwind Traders", undefined, { timeout: 3000 }));
    const close = await screen.findByRole("button", { name: "Close" });
    const panel = close.closest(".white-card") as HTMLElement;
    expect(within(panel).getByDisplayValue("Northwind Traders")).toBeTruthy();
    for (const label of ["Attributes", "Relationships", "Actions"]) {
      expect(within(panel).getByRole("heading", { name: label })).toBeTruthy();
    }
  });

  it("installs the bridge for its own mount only", async () => {
    renderPage();
    await screen.findByTitle("Switch ontology", undefined, { timeout: 3000 });
    expect((window as { dopl?: unknown }).dopl).toBeDefined();
    cleanup();
    expect((window as { dopl?: unknown }).dopl).toBeUndefined();
  });

  it("switches scenario to a fresh server", async () => {
    renderPage();
    await screen.findByTitle("Switch ontology", undefined, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "States" }));
    fireEvent.click(screen.getByRole("button", { name: "No ontologies yet" }));
    await waitFor(() => expect(screen.getByText("No ontologies yet.")).toBeTruthy(), {
      timeout: 3000,
    });
  });
});
