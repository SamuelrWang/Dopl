/**
 * INVARIANT SUITE — the graph view's pending gate.
 *
 * "New cluster" puts a cluster, a seed column and a seed card on screen under
 * `pending:<uuid>` ids and only then runs three serial POSTs. For the length of
 * that round trip the graph is fully interactive, and every write it can reach
 * names an id the server has never seen:
 *
 *   - a layout PATCH at a provisional CLUSTER id → rejected, and the user gets
 *     "Couldn't save layout" plus a snapshot invalidation for a drag on a board
 *     that is working fine;
 *   - a dragged provisional NODE → `pending:<uuid>` persisted as a key inside
 *     `clusters.layout`, where nothing ever collects it again.
 *
 * Both are closed by the id, not by the class: `makeLayoutPersist` refuses the
 * write, and the body withholds `onPointerDown` from a pending node.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PENDING_ATTR } from "@/shared/ui/pending";
import type { GraphState } from "../graph-state";
import type { OntologyCluster, OntologyObject } from "../types";
import { OntologyGraphBody, makeLayoutPersist } from "./graph-body";

const updateCluster = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../client/api", () => ({ updateCluster }));

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const LAYOUT = { "obj-1": { x: 16, y: 32 } };
const noop = () => {};

describe("makeLayoutPersist", () => {
  it("writes the layout for a real cluster id", async () => {
    updateCluster.mockClear();
    await makeLayoutPersist(WORKSPACE, "cluster-1", noop)(LAYOUT);
    expect(updateCluster).toHaveBeenCalledWith(WORKSPACE, "cluster-1", { layout: LAYOUT });
  });

  it("writes NOTHING while the cluster id is provisional", async () => {
    updateCluster.mockClear();
    const onError = vi.fn();
    await makeLayoutPersist(WORKSPACE, "pending:abc", onError)(LAYOUT);
    // Not "sent and tolerated" — never sent. A rejected PATCH would toast.
    expect(updateCluster).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces a real failure to the caller rather than swallowing it", async () => {
    const boom = new Error("nope");
    updateCluster.mockClear();
    updateCluster.mockRejectedValueOnce(boom);
    const onError = vi.fn();
    await makeLayoutPersist(WORKSPACE, "cluster-1", onError)(LAYOUT);
    expect(onError).toHaveBeenCalledWith(boom);
  });
});

function object(id: string, over: Partial<OntologyObject> = {}): OntologyObject {
  return {
    id,
    name: id,
    subtitle: "",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: [],
    template: [],
    ...over,
  };
}

const CLUSTER: OntologyCluster = {
  id: "cluster-1",
  slug: "c",
  name: "C",
  purpose: "",
  columnIds: ["real-col", "pending:col"],
  layout: {},
};

const GRAPH: GraphState = {
  clusters: [CLUSTER],
  objects: {
    "real-col": object("real-col"),
    "pending:col": object("pending:col"),
  },
};

function body(pendingIds: ReadonlySet<string>) {
  return renderToStaticMarkup(
    <OntologyGraphBody
      workspaceId={WORKSPACE}
      graph={GRAPH}
      cluster={CLUSTER}
      canEdit
      pendingIds={pendingIds}
      selectedId={null}
      onSelect={noop}
      onAddObject={noop}
      onLayoutError={noop}
      onLayoutResetChange={noop}
    />
  );
}

/** The markup of one node card, split off the sibling it renders next to. */
function cards(markup: string): string[] {
  return markup.split('role="button"').slice(1);
}

describe("OntologyGraphBody pending threading", () => {
  it("marks only the pending node inert, and only it", () => {
    const [real, pending] = cards(body(new Set(["pending:col"])));
    expect(pending).toContain(PENDING_ATTR);
    expect(pending).toContain("pointer-events-none");
    expect(real).not.toContain(PENDING_ATTR);
    expect(real).not.toContain("pointer-events-none");
  });

  it("withholds the drag affordance from a pending node", () => {
    const [real, pending] = cards(body(new Set(["pending:col"])));
    // `cursor-grab` is rendered exactly when `onPointerDown` was passed, so it
    // reads the prop the drag hook actually receives, not a decoration.
    expect(real).toContain("cursor-grab");
    expect(pending).not.toContain("cursor-grab");
    expect(pending).toContain("cursor-pointer");
  });

  it("blocks add-card on the pending column and leaves the real one open", () => {
    const [real, pending] = cards(body(new Set(["pending:col"])));
    expect(pending).toContain("disabled");
    expect(real).not.toContain("disabled");
  });

  it("leaves every node interactive when nothing is pending", () => {
    const markup = body(new Set());
    expect(markup).not.toContain(PENDING_ATTR);
    expect(markup).not.toContain("disabled");
    expect(cards(markup).every((c) => c.includes("cursor-grab"))).toBe(true);
  });
});
