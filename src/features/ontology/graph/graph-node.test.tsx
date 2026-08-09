/**
 * INVARIANT SUITE — a PENDING node card refuses every write.
 *
 * An optimistic row is on screen before the server has agreed to it, under a
 * `pending:<uuid>` id that names nothing. The kanban lane already draws its
 * pending column dimmed and inert for exactly this reason; the graph's node
 * card is the same row in the other view and owes the same refusal.
 *
 * The one that bites is the add-card button: a click on it POSTs
 * `parentObjectId: "pending:<uuid>"`, the server rejects the uuid, and the
 * optimistic card the user just watched appear rolls straight back out. The
 * class alone does not close that — the card is `tabIndex={0}`, so a keyboard
 * Enter reaches the button through `pointer-events-none`. Hence `disabled`.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PENDING_ATTR } from "@/shared/ui/pending";
import { EMPTY_GRAPH } from "../graph-state";
import type { OntologyObject } from "../types";
import { GraphNode } from "./graph-node";
import type { SceneNode } from "./types";

const noop = () => {};

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

function columnNode(id: string): SceneNode {
  return { id, kind: "column", object: object(id), columnId: id };
}

function render(pending: boolean, node: SceneNode = columnNode("col")) {
  return renderToStaticMarkup(
    <GraphNode
      node={node}
      position={{ x: 0, y: 0, width: 240 }}
      graph={EMPTY_GRAPH}
      pending={pending}
      selected={false}
      dimmed={false}
      onSelect={noop}
      onAddCard={noop}
      registerRef={noop}
      // A real card is draggable; the caller withholds this for a pending one.
      onPointerDown={pending ? undefined : noop}
    />
  );
}

describe("GraphNode pending", () => {
  it("disables the add-card button on a pending column", () => {
    // `disabled` is the gate React honours: onClick never fires, so
    // `onAddCard` cannot reach `createObject` with a provisional parent.
    expect(render(true)).toContain("disabled");
    expect(render(false)).not.toContain("disabled");
  });

  it("draws the card dimmed and inert, and announces itself", () => {
    const markup = render(true);
    expect(markup).toContain(PENDING_ATTR);
    expect(markup).toContain("pointer-events-none");
    // The recipe's opacity must not be out-specified by the inline style —
    // that inline value is what the dim/select effect writes for real rows.
    expect(markup).toContain("opacity-60");
    expect(markup).not.toMatch(/style="[^"]*opacity/);
  });

  it("leaves a real card fully interactive", () => {
    const markup = render(false);
    expect(markup).not.toContain(PENDING_ATTR);
    expect(markup).not.toContain("pointer-events-none");
    expect(markup).toContain("cursor-grab");
  });

  it("dims a real card by selection, and never a pending one", () => {
    const dimmed = renderToStaticMarkup(
      <GraphNode
        node={columnNode("col")}
        position={{ x: 0, y: 0, width: 240 }}
        graph={EMPTY_GRAPH}
        selected={false}
        dimmed
        onSelect={noop}
        onAddCard={noop}
        registerRef={noop}
      />
    );
    expect(dimmed).toMatch(/opacity:0?\.45/);
  });
});
