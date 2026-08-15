import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BASE_B_SEG,
  NEW_BASE_SEG,
  RENAMED_B_SEG,
  SEGMENT,
  installKnowledgeBridge,
  paths,
  renderAt,
} from "./test-fixtures";

/**
 * BASE DETAIL — `/knowledge/:kbSlug`, plus every way a URL resolves into it:
 * deep links, legacy slugs, the canonical-segment replace, and create / rename
 * / delete moves that change which base the URL names.
 *
 * Card grid behaviour: `./home.test.tsx`. Shared fake server:
 * `./test-fixtures.tsx`.
 */

describe("knowledge base detail", () => {
  beforeEach(installKnowledgeBridge);

  it("scopes the detail pane to ONE base's tree, under a breadcrumb", async () => {
    renderAt(`/${SEGMENT}/knowledge/${BASE_B_SEG}`);
    await screen.findByDisplayValue("Cold outreach");

    expect(screen.getByText("Discovery call")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Product specs" })).toBeNull();
    expect(screen.queryByPlaceholderText("Search")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();

    const crumbs = screen.getByLabelText("Knowledge base breadcrumb");
    expect(crumbs.textContent).toContain("Knowledge");
    expect(crumbs.textContent).toContain("Sales playbook");
    expect(within(crumbs).getByRole("button", { name: "Knowledge" })).toBeInTheDocument();
  });

  it("selects a newly created base instead of dropping the navigation", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("article", { name: "Sales playbook" });

    fireEvent.click(screen.getByLabelText("New knowledge base"));
    // ⚠ ModalShell mounts a frame later (rAF-driven enter transition).
    fireEvent.change(await screen.findByPlaceholderText("e.g. Product specs"), {
      target: { value: "Onboarding" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // ⚠ Created base is seeded into the cached list BEFORE the URL moves, so
    // the controller can resolve the segment it is handed.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/${SEGMENT}/knowledge/${NEW_BASE_SEG}`
      );
    });
    // Tree request is the proof of SELECTED, not merely listed: without the
    // seed the controller drops the move while the row still appears.
    await waitFor(() => {
      expect(paths()).toContain("/api/knowledge/bases/base-c/tree");
    });
    expect(screen.getAllByText("Onboarding")).toHaveLength(2);
  });

  it("keeps the renamed slug in the URL when the selection next changes", async () => {
    // ⚠ A rename reaches this tree as a fresh `bases` row, never as a new
    // selection — a URL built from the RAW selection keeps the old slug and
    // re-asserts it the next time anything is selected.
    const router = renderAt(`/${SEGMENT}/knowledge/${BASE_B_SEG}`);
    await screen.findByDisplayValue("Cold outreach");

    fireEvent.click(screen.getByLabelText("Knowledge base settings"));
    fireEvent.click(await screen.findByText(/Show URL slug/));
    fireEvent.change(screen.getByDisplayValue("sales-playbook"), {
      target: { value: "playbook-v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/${SEGMENT}/knowledge/${RENAMED_B_SEG}`
      );
    });

    fireEvent.click(screen.getByText("Discovery call"));

    await waitFor(() => {
      expect(router.state.location.search).toBe("?entryId=entry-2");
    });
    expect(router.state.location.pathname).toBe(
      `/${SEGMENT}/knowledge/${RENAMED_B_SEG}`
    );
  });

  it("resolves a legacy slug arriving over history, not just on a cold load", async () => {
    // ⚠ Controller's URL→selection handler and the page's deep-link resolver
    // must speak ONE grammar: a legacy slug-only URL pushed into history has to
    // select its base exactly as on first paint.
    const router = renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("article", { name: "Sales playbook" });

    await act(() => router.navigate(`/${SEGMENT}/knowledge/sales-playbook`));

    await waitFor(() => {
      expect(paths()).toContain("/api/knowledge/bases/base-b/tree");
    });
    expect(screen.getAllByText("Sales playbook")).toHaveLength(2);
  });

  it("resolves a deep link's base and its ?entryId= target", async () => {
    renderAt(`/${SEGMENT}/knowledge/${BASE_B_SEG}?entryId=entry-2`);

    expect(await screen.findByDisplayValue("Discovery call")).toBeInTheDocument();
    expect(paths()).toContain("/api/knowledge/bases/base-b/tree");
    expect(paths()).toContain("/api/knowledge/entries/entry-2");
  });

  it("falls back to the base's first entry when ?entryId= is not in its tree", async () => {
    renderAt(`/${SEGMENT}/knowledge/${BASE_B_SEG}?entryId=entry-from-another-base`);

    expect(await screen.findByDisplayValue("Cold outreach")).toBeInTheDocument();
    expect(paths()).not.toContain("/api/knowledge/entries/entry-from-another-base");
  });

  it("replaces a legacy KB slug with the canonical segment, keeping ?entryId=", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge/sales-playbook?entryId=entry-2`);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/${SEGMENT}/knowledge/${BASE_B_SEG}`
      );
    });
    // ⚠ The replace must preserve the query string, or the deep link silently
    // demotes to the base.
    expect(router.state.location.search).toBe("?entryId=entry-2");
    expect(await screen.findByDisplayValue("Discovery call")).toBeInTheDocument();
  });

  it("surfaces an unknown KB segment as the shared error card", async () => {
    renderAt(`/${SEGMENT}/knowledge/ghost-base`);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Knowledge base not found"
    );
  });

  it("falls back to the knowledge root when the deep-linked base is DELETED", async () => {
    // ⚠ Deep link is frozen at mount and this component never remounts, so it
    // outlives its target. Deletes are permanent, so this is the ORDINARY way a
    // resolved deep link loses its base; treating it like the unknown-segment
    // 404 above turns the page into an error card only a reload clears.
    const router = renderAt(`/${SEGMENT}/knowledge/${BASE_B_SEG}`);
    await screen.findByDisplayValue("Cold outreach");

    fireEvent.click(screen.getByLabelText("Delete knowledge base"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete permanently" })
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/knowledge`);
    });
    expect(
      await screen.findByRole("article", { name: "Product specs" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    // ⚠ waitFor, not bare expect: the deep-linked ENTRY selection clears a tick
    // after the route change (list refetch → selection recompute → breadcrumb
    // unmount), so a sync assertion passes only on a fast machine. The
    // breadcrumb goes last, which is why it is what to pin.
    await waitFor(() =>
      expect(
        screen.queryByRole("article", { name: "Sales playbook" })
      ).not.toBeInTheDocument()
    );
  });
});
