"use client";

import {
  boundRecord,
  definePersistedState,
  isStoredId,
  omitKey,
} from "@/shared/lib/persisted-ui-state";

/**
 * Where this device last was on the ontology surface, per user and per workspace:
 * which ontology, which face of it (board or changelog), and which object's panel
 * was open on each ontology. Restored by `components/ontology-view.tsx` and the
 * /home host (`apps/desktop-ui/src/pages/home/ontology-panels.tsx`), so leaving
 * the page, reloading or restarting lands where the operator was, not on
 * `ontologies[0]` with the panel shut (Samuel, 2026-10-05 / 2026-10-08).
 *
 * A convenience, never a permission: every id is replayed through the graph the
 * server already sent, so a remembered ontology or object the reader may no
 * longer see simply does not resolve. Nothing here widens reach.
 *
 * ⚠ The URL stays the source of truth: a deep-linked slug outranks this memory
 * (the view's precedence chain). Memory is only the default for an address that
 * names no ontology.
 */

/** The two faces an ontology has. Board is the default for anything unknown. */
export type OntologyFace = "board" | "changelog";

export interface OntologyMemory {
  /** Last ontology open, or null when none is remembered. */
  ontologyId: string | null;
  face: OntologyFace;
  /** ontologyId → the object whose panel was open on it. */
  objects: Readonly<Record<string, string>>;
}

/**
 * Bound on remembered object selections. One entry per ontology ever opened
 * would grow without limit in a long-lived install; the oldest falls off.
 */
export const MAX_REMEMBERED_OBJECTS = 50;

const EMPTY: OntologyMemory = { ontologyId: null, face: "board", objects: {} };

/**
 * Tolerant decode of today's shape. Exported for tests; storage goes through
 * `persisted-ui-state.ts`, which hands pre-envelope values in at version 0:
 * the 2026-10-05 bare ontology id, or 61163020's un-enveloped object.
 */
export function parseMemory(raw: unknown): OntologyMemory {
  if (isStoredId(raw)) return { ...EMPTY, ontologyId: raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY;
  const v = raw as Record<string, unknown>;
  const objects: Record<string, string> = {};
  if (v.objects && typeof v.objects === "object") {
    for (const [k, id] of Object.entries(v.objects as Record<string, unknown>)) {
      if (isStoredId(k) && isStoredId(id)) objects[k] = id;
    }
  }
  return {
    ontologyId: isStoredId(v.ontologyId) ? v.ontologyId : null,
    face: v.face === "changelog" ? "changelog" : "board",
    objects: boundRecord(objects, MAX_REMEMBERED_OBJECTS),
  };
}

/**
 * ⚠ The name keeps the key 61163020 shipped (`dopl.ontology.lastOpened:<u>:<ws>`),
 * so memory written by that build is read, not orphaned.
 */
const store = definePersistedState<OntologyMemory>({
  name: "ontology.lastOpened",
  version: 1,
  fallback: EMPTY,
  decode: (raw) => parseMemory(raw),
  isEmpty: (m) => m.ontologyId === null && m.face === "board" && !Object.keys(m.objects).length,
});

const scope = (userId: string | undefined, workspaceId: string) => ({ userId, workspaceId });

/** This device's memory for the pair; EMPTY when none or unreadable. */
export function readMemory(userId: string | undefined, workspaceId: string): OntologyMemory {
  return store.read(scope(userId, workspaceId));
}

function update(
  userId: string | undefined,
  workspaceId: string,
  change: (m: OntologyMemory) => OntologyMemory
): void {
  store.update(scope(userId, workspaceId), change);
}

/** This device's last-opened ontology id for the pair, or null. */
export function readLastOpened(userId: string | undefined, workspaceId: string): string | null {
  return readMemory(userId, workspaceId).ontologyId;
}

/** Remember the open ontology. Leaves the face and object selections alone. */
export function writeLastOpened(
  userId: string | undefined,
  workspaceId: string,
  ontologyId: string
): void {
  update(userId, workspaceId, (m) =>
    m.ontologyId === ontologyId ? m : { ...m, ontologyId }
  );
}

/** Forget a remembered ontology that no longer resolves, with its object selection. */
export function forgetOntology(
  userId: string | undefined,
  workspaceId: string,
  ontologyId: string
): void {
  update(userId, workspaceId, (m) => {
    return {
      ...m,
      ontologyId: m.ontologyId === ontologyId ? null : m.ontologyId,
      objects: omitKey(m.objects, ontologyId),
    };
  });
}

/** Remember which face (board / changelog) is showing. */
export function writeFace(
  userId: string | undefined,
  workspaceId: string,
  face: OntologyFace
): void {
  update(userId, workspaceId, (m) => (m.face === face ? m : { ...m, face }));
}

/**
 * Remember (or, with null, forget) the object whose panel is open on an ontology.
 * Re-inserted at the end so the bound drops the least recently touched.
 */
export function writeSelectedObject(
  userId: string | undefined,
  workspaceId: string,
  ontologyId: string,
  objectId: string | null
): void {
  update(userId, workspaceId, (m) => {
    if ((m.objects[ontologyId] ?? null) === objectId) return m;
    const rest = omitKey(m.objects, ontologyId);
    if (objectId === null) return { ...m, objects: rest };
    return {
      ...m,
      objects: boundRecord({ ...rest, [ontologyId]: objectId }, MAX_REMEMBERED_OBJECTS),
    };
  });
}

/** Forget the whole pair. */
export function clearLastOpened(userId: string | undefined, workspaceId: string): void {
  store.clear(scope(userId, workspaceId));
}
