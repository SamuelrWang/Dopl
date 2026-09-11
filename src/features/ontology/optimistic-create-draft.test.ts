/**
 * INVARIANT SUITE — "+ Object" AS A DRAFT LANE (2026-09-11, Samuel: *"I want the
 * column UI to immediately appear on the thing, but at the same time, a pop-up
 * comes up. If the user doesn't actually end up creating it, that little thing
 * disappears"*).
 *
 * ⚠ SPLIT FROM `optimistic-create.test.ts` for the 500-line cap; same harness,
 * same claim shape — what LEFT, and when.
 */

import { describe, expect, it } from "vitest";
import type { GraphState } from "./graph-state";
import {
  beginColumnDraft,
  commitColumnDraftOptimistic,
  discardColumnDraft,
  isPendingOntologyId,
  NEW_COLUMN_NAME,
} from "./optimistic-create";
import { flush, harness, savedCluster, savedObject } from "./optimistic-create-harness";

/**
 * THE "+ Object" DRAFT LANE (2026-09-11, Samuel: *"I want the column UI to
 * immediately appear on the thing, but at the same time, a pop-up comes up. If
 * the user doesn't actually end up creating it, that little thing disappears"*).
 *
 * ⚠ THE CLAIM UNDER TEST IS **WHAT LEAVES**, not what renders: this is the ONE
 * create path that sends nothing from the click, because a discard has to be
 * free. `h.sent` is the whole proof.
 */
describe("the object draft — begin / discard", () => {
  const cluster = savedCluster({ id: "c1", slug: "c1", columnIds: [] });
  const board: GraphState = { clusters: [cluster], objects: {} };

  /**
   * ⚠ MUTATION-VERIFIED — one revert, one failure: pointing `beginColumnDraft`
   * at `createObjectOptimistic` (the lane still appears, still reads "Untitled
   * object" and is still pending — only the empty `h.sent` says nothing left).
   */
  it("puts the lane on the board and sends NOTHING", () => {
    const h = harness();
    h.seed(board);
    const row = beginColumnDraft(h.sink, "c1");

    expect(h.board.clusters[0]!.columnIds).toEqual([row.id]);
    expect(row.name).toBe(NEW_COLUMN_NAME);
    expect(isPendingOntologyId(row.id)).toBe(true);
    expect(h.pending.has(row.id)).toBe(true);
    expect(h.sent).toEqual([]);
    // ⚠ AND THE WRITE GATE STAYS SHUT: nothing is in flight, so a realtime
    // snapshot is free to arrive while the popup is open.
    expect(h.writesInFlight).toBe(0);
  });

  it("takes the lane back off on discard, with no request in either direction", () => {
    const h = harness();
    h.seed(board);
    const row = beginColumnDraft(h.sink, "c1");
    discardColumnDraft(h.sink, row.id);

    expect(h.board).toEqual(board);
    expect(h.pending.size).toBe(0);
    expect(h.sent).toEqual([]);
    expect(h.deletedClusters).toEqual([]);
  });
});

describe("the object draft — commit", () => {
  const cluster = savedCluster({ id: "c1", slug: "c1", columnIds: [] });
  const board: GraphState = { clusters: [cluster], objects: {} };
  const patch = {
    name: "Deal",
    subtitle: "One live opportunity",
    template: [{ key: "owner", label: "Owner", kind: "text" as const }],
  };

  /**
   * ⚠ MUTATION-VERIFIED — one revert, one failure: dropping the `OBJECT_UPDATE`
   * before the POST (the row still lands, the PATCH still carries the fields, and
   * only the lane's name at submit time says the board lied for a round trip).
   */
  it("wears the typed name before the POST leaves, and POSTs that name", () => {
    const h = harness();
    h.seed(board);
    const row = beginColumnDraft(h.sink, "c1");
    commitColumnDraftOptimistic(h.api, h.sink, "c1", row, patch);

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({
      op: "createObject",
      input: { clusterId: "c1", name: "Deal" },
    });
    expect(h.sent[0]!.board.objects[row.id]!.name).toBe("Deal");
    expect(h.writesInFlight).toBe(1);
  });

  it("PATCHes description + fields at the id the POST minted, never the draft's", async () => {
    const h = harness();
    h.seed(board);
    const row = beginColumnDraft(h.sink, "c1");
    const { done } = commitColumnDraftOptimistic(h.api, h.sink, "c1", row, patch);

    h.objectCalls[0]!.settle(savedObject("object-real", { name: "Deal" }));
    await flush();

    expect(h.sent[1]).toMatchObject({
      op: "updateObject",
      input: {
        objectId: "object-real",
        subtitle: "One live opportunity",
        template: patch.template,
      },
    });
    h.patchCalls[0]!.settle(savedObject("object-real"));
    await done;

    expect(h.board.clusters[0]!.columnIds).toEqual(["object-real"]);
    expect(h.pending.size).toBe(0);
    expect(h.createdCount).toBe(1);
  });

  it("sends no PATCH when the popup collected only a name", async () => {
    const h = harness();
    h.seed(board);
    const row = beginColumnDraft(h.sink, "c1");
    const { done } = commitColumnDraftOptimistic(h.api, h.sink, "c1", row, {
      name: "Deal",
      subtitle: "",
      template: [],
    });

    h.objectCalls[0]!.settle(savedObject("object-real"));
    await done;

    expect(h.sent.map((s) => s.op)).toEqual(["createObject"]);
  });

  it("removes the lane when the POST is refused", async () => {
    const h = harness();
    h.seed(board);
    const row = beginColumnDraft(h.sink, "c1");
    const { done } = commitColumnDraftOptimistic(h.api, h.sink, "c1", row, patch);

    const boom = new Error("refused");
    h.objectCalls[0]!.fail(boom);
    expect(await done).toBeNull();

    expect(h.board).toEqual(board);
    expect(h.failures).toEqual([{ what: "create object", err: boom }]);
    expect(h.pending.size).toBe(0);
    expect(h.writesInFlight).toBe(0);
  });

  /**
   * 🔒 A REFUSED PATCH KEEPS THE LANE. The row exists server-side by then, and
   * deleting the operator's object because its description did not save would
   * destroy more than it repairs — it reports instead.
   */
  it("keeps the lane when only the follow-up PATCH fails", async () => {
    const h = harness();
    h.seed(board);
    const row = beginColumnDraft(h.sink, "c1");
    const { done } = commitColumnDraftOptimistic(h.api, h.sink, "c1", row, patch);

    h.objectCalls[0]!.settle(savedObject("object-real", { name: "Deal" }));
    await flush();
    const boom = new Error("nope");
    h.patchCalls[0]!.fail(boom);
    await done;

    expect(h.board.clusters[0]!.columnIds).toEqual(["object-real"]);
    expect(h.failures).toEqual([{ what: "object", err: boom }]);
    expect(h.writesInFlight).toBe(0);
  });
});
