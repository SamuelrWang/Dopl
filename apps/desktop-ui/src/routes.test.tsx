import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "@/lib/query-client";
import { WORKSPACE_PAGES, routes } from "@/routes";

/**
 * The scaffold's smoke test: the REAL route table renders under the REAL
 * provider stack. A memory router stands in for the hash router only so the
 * initial URL can be set; every route object is the shipped one.
 */
function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("app routes", () => {
  it("renders a workspace page inside the app layout", async () => {
    renderAt("/acme-ab12cd/skills");

    expect(await screen.findByRole("heading", { name: "Skills" })).toBeInTheDocument();
    // The layout's nav is driven by the same table the routes are.
    expect(screen.getByRole("link", { name: "Knowledge" })).toHaveAttribute(
      "href",
      "/acme-ab12cd/knowledge"
    );
  });

  it("redirects the workspace root to the home page", async () => {
    renderAt("/acme-ab12cd");

    expect(await screen.findByRole("heading", { name: "Canvas" })).toBeInTheDocument();
  });

  it("resolves a detail route with its param", async () => {
    renderAt("/acme-ab12cd/knowledge/some-base-9f2a");

    expect(
      await screen.findByRole("heading", { name: "Knowledge base" })
    ).toBeInTheDocument();
  });

  it("mirrors the web app's page list", () => {
    expect(WORKSPACE_PAGES.map((page) => page.path)).toEqual([
      "overview",
      "canvas",
      "ontology",
      "knowledge",
      "knowledge/:kbSlug",
      "skills",
      "skills/:skillSlug",
      "workflows",
      "workflows/:workflowSlug",
      "chats",
      "channels",
      "members",
      "settings",
      "configuration",
    ]);
  });
});
