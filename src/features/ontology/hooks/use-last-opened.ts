"use client";

/**
 * The ontology surface's device memory, as hooks: read before the selection
 * fallback chains resolve, written after. Storage itself is `../last-opened.ts`;
 * this file owns WHEN it is touched.
 *
 * Split read/write because the read feeds a chain and the write consumes its
 * result — one hook could not sit on both sides of it.
 */

import { useEffect, useMemo } from "react";
import {
  forgetOntology,
  readLastOpened,
  readMemory,
  writeLastOpened,
  writeSelectedObject,
} from "../last-opened";
import type { Ontology, OntologyObject } from "../types";
import type { OntologyStatus } from "./use-ontology";

type ObjectsById = { objects: Readonly<Record<string, Pick<OntologyObject, "childIds">>> };

/**
 * This device's last-opened ontology id for (reader, workspace), or null.
 *
 * Read DURING RENDER, never in an effect: an effect would paint the default first
 * and swap on the next frame, and that flicker is the whole thing this removes.
 * Keyed on the pair, so a workspace switch — which reconciles the board rather
 * than remounting it — re-reads instead of carrying the old workspace's choice.
 *
 * `enabled` is false under a pin: the host owns that selection.
 */
export function useRememberedOntologyId(
  enabled: boolean,
  currentUserId: string | undefined,
  workspaceId: string
): string | null {
  return useMemo(
    () => (enabled ? readLastOpened(currentUserId, workspaceId) : null),
    [enabled, currentUserId, workspaceId]
  );
}

/**
 * Keeps the stored ontology id in step with the board: remembers what is open,
 * and forgets a remembered id that no longer resolves.
 *
 * `openId` is the ontology actually on screen, whatever rung of the chain chose
 * it — arriving by deep link is opening it too, and the next visit lands there.
 */
export function useRememberOntology({
  enabled,
  currentUserId,
  workspaceId,
  ontologies,
  status,
  openId,
  rememberedId,
}: {
  enabled: boolean;
  currentUserId: string | undefined;
  workspaceId: string;
  ontologies: readonly Pick<Ontology, "id">[];
  status: OntologyStatus;
  openId: string | null;
  rememberedId: string | null;
}): void {
  // ⚠ Both halves wait for "ready". While loading the list is EMPTY: a write
  // would store the nothing it shows, and a sweep would read every id as
  // dangling and wipe a good memory on each mount.
  const ready = enabled && status === "ready";

  // A provisional id from an optimistic create can land here; `onIdsResolved`
  // remaps it and this re-fires with the real one. One left behind by a close
  // mid-POST is swept below on the next visit.
  const toStore = ready ? openId : null;
  useEffect(() => {
    if (toStore) writeLastOpened(currentUserId, workspaceId, toStore);
  }, [toStore, currentUserId, workspaceId]);

  // Deleted, renamed away from nothing (ids survive renames), or access gone.
  // The display already fell through a rung; this stops the dead id being
  // consulted again. Only that ontology's entries go: the face survives.
  const dangling =
    ready && rememberedId && !ontologies.some((c) => c.id === rememberedId)
      ? rememberedId
      : null;
  useEffect(() => {
    if (dangling) forgetOntology(currentUserId, workspaceId, dangling);
  }, [dangling, currentUserId, workspaceId]);
}

/**
 * True when `objectId` is on `ontology`'s board: a column, or anything contained
 * under one. An id from another ontology (or a deleted one) must not reopen a
 * panel over the wrong board.
 */
export function objectOnOntology(
  graph: ObjectsById,
  ontology: Pick<Ontology, "columnIds">,
  objectId: string
): boolean {
  const seen = new Set<string>();
  const stack = [...ontology.columnIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === objectId) return Boolean(graph.objects[id]);
    const obj = graph.objects[id];
    if (obj) stack.push(...obj.childIds);
  }
  return false;
}

/**
 * The object panel's memory for the open ontology.
 *
 * `chosen` is the view's own state: `undefined` until the operator has picked or
 * closed a panel on THIS ontology since it opened, `null` for "closed", an id for
 * "open". Returns the id the panel should show: the choice when there is one,
 * else this device's remembered object for the ontology if it is still on the
 * board, else null.
 *
 * Writes back what is shown once the operator has chosen, and forgets a
 * remembered object that no longer resolves. Same "ready" rule as above.
 */
export function useRememberedObject({
  currentUserId,
  workspaceId,
  graph,
  status,
  ontology,
  chosen,
}: {
  currentUserId: string | undefined;
  workspaceId: string;
  graph: ObjectsById;
  status: OntologyStatus;
  ontology: Pick<Ontology, "id" | "columnIds"> | null;
  chosen: string | null | undefined;
}): string | null {
  const ready = status === "ready" && ontology !== null;
  const ontologyId = ontology?.id ?? null;

  // Read once per (pair, ontology) opening, not per render: a write made after
  // the restore must not feed back into it.
  const remembered = useMemo(
    () =>
      ready && ontologyId
        ? (readMemory(currentUserId, workspaceId).objects[ontologyId] ?? null)
        : null,
    [ready, ontologyId, currentUserId, workspaceId]
  );
  const restorable =
    remembered && ontology && objectOnOntology(graph, ontology, remembered)
      ? remembered
      : null;

  const shown = chosen !== undefined ? chosen : restorable;

  // What to persist: the operator's choice once made (null = panel closed), or
  // null when the remembered object is gone. `undefined` = leave storage alone.
  let toStore: string | null | undefined;
  if (!ready) toStore = undefined;
  // A chosen id the graph no longer has (deleted while open) is a closed panel.
  else if (chosen !== undefined) toStore = chosen && graph.objects[chosen] ? chosen : null;
  else if (remembered && !restorable) toStore = null;
  else toStore = undefined;

  useEffect(() => {
    if (toStore === undefined || !ontologyId) return;
    writeSelectedObject(currentUserId, workspaceId, ontologyId, toStore);
  }, [toStore, ontologyId, currentUserId, workspaceId]);

  return shown;
}
