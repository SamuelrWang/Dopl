import { useEffect } from "react";
import { act, render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import type { KnowledgeUrlSync } from "@/features/knowledge/components/knowledge-v2/routing";
import { useKnowledgeUrlSync } from "./use-knowledge-url-sync";

/**
 * The adapter's two invariants, pinned directly rather than through the page.
 *
 * They pull in opposite directions and that tension is the whole design: the
 * object must NOT be rebuilt when the URL changes (the knowledge controller
 * lists it in an effect's deps, so a new identity re-runs that effect with the
 * pre-change selection and writes the old URL back over the new one), yet
 * `current`/`read` must still see the URL that just changed. Satisfying one by
 * sacrificing the other is the failure mode this file exists to catch.
 */

const SEGMENT = "acme-ab12cd34ef56";

/** A CHILD of the hook's host, reading the sync from its own passive effect —
 *  which is exactly where the knowledge controller reads it. */
function ChildReader({ sync, seen }: { sync: KnowledgeUrlSync; seen: string[] }) {
  const location = useLocation();
  useEffect(() => {
    seen.push(sync.current());
  }, [sync, location, seen]);
  return null;
}

function renderProbe(initialEntry: string) {
  const seen: KnowledgeUrlSync[] = [];
  function Probe() {
    seen.push(useKnowledgeUrlSync(SEGMENT));
    return null;
  }
  const router = createMemoryRouter(
    [
      { path: "/:workspaceSegment/knowledge", element: <Probe /> },
      { path: "/:workspaceSegment/knowledge/:kbSlug", element: <Probe /> },
    ],
    { initialEntries: [initialEntry] }
  );
  render(<RouterProvider router={router} />);
  return { seen, router };
}

describe("useKnowledgeUrlSync", () => {
  it("keeps ONE identity across location changes while reading the live URL", async () => {
    const { seen, router } = renderProbe(`/${SEGMENT}/knowledge`);
    const first = seen[0];
    expect(first.current()).toBe(`/${SEGMENT}/knowledge`);

    await act(() => router.navigate(`/${SEGMENT}/knowledge/specs-aaaaaaaaaaaa?entryId=e1`));

    // Stable: every render handed out the same object.
    expect(new Set(seen).size).toBe(1);
    // …and that one object sees the new URL, not the one it was built on.
    expect(first.current()).toBe(
      `/${SEGMENT}/knowledge/specs-aaaaaaaaaaaa?entryId=e1`
    );
    expect(first.read()).toEqual({
      baseSegment: "specs-aaaaaaaaaaaa",
      entryId: "e1",
    });

    await act(() => router.navigate(-1));

    expect(new Set(seen).size).toBe(1);
    expect(first.read()).toEqual({ baseSegment: null, entryId: null });
  });

  it("is already current when a CHILD's effect reads it on the same commit", async () => {
    // The controller lives one level below the hook's host, so its effects run
    // BEFORE the host's passive effects. A ref refreshed passively would still
    // hold the previous URL at that moment; a layout effect has already run.
    const readsFromChild: string[] = [];
    const hosted: KnowledgeUrlSync[] = [];
    function Host() {
      const sync = useKnowledgeUrlSync(SEGMENT);
      hosted.push(sync);
      return <ChildReader sync={sync} seen={readsFromChild} />;
    }
    const router = createMemoryRouter(
      [
        { path: "/:workspaceSegment/knowledge", element: <Host /> },
        { path: "/:workspaceSegment/knowledge/:kbSlug", element: <Host /> },
      ],
      { initialEntries: [`/${SEGMENT}/knowledge`] }
    );
    render(<RouterProvider router={router} />);

    await act(() => router.navigate(`/${SEGMENT}/knowledge/a-aaaaaaaaaaaa`));
    await act(() => router.navigate(-1));

    expect(hosted.length).toBeGreaterThan(0);
    expect(readsFromChild).toEqual([
      `/${SEGMENT}/knowledge`,
      `/${SEGMENT}/knowledge/a-aaaaaaaaaaaa`,
      `/${SEGMENT}/knowledge`,
    ]);
  });

  it("notifies subscribers on every location change, including its own writes", async () => {
    const { seen, router } = renderProbe(`/${SEGMENT}/knowledge`);
    const sync = seen[0];
    const observed: string[] = [];
    let unsubscribe = () => {};
    act(() => {
      unsubscribe = sync.subscribe(() => observed.push(sync.current()));
    });

    await act(() => router.navigate(`/${SEGMENT}/knowledge/a-aaaaaaaaaaaa`));
    await act(async () => {
      sync.write(`/${SEGMENT}/knowledge/b-bbbbbbbbbbbb`, "replace");
    });

    expect(observed).toEqual([
      `/${SEGMENT}/knowledge/a-aaaaaaaaaaaa`,
      `/${SEGMENT}/knowledge/b-bbbbbbbbbbbb`,
    ]);
    expect(router.state.historyAction).toBe("REPLACE");

    act(() => unsubscribe());
    await act(() => router.navigate(`/${SEGMENT}/knowledge`));
    expect(observed).toHaveLength(2);
  });
});
