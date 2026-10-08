"use client";

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

const LAST_OPENED_KEY = "dopl.ontology.lastOpened";

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
 * Per user AND per workspace. Per user because one machine holds more than one
 * account (`search/use-search.ts › storageKey`, same reason); per workspace
 * because one account holds several, and an id from the wrong one names nothing.
 */
function storageKey(userId: string | undefined, workspaceId: string): string {
  return `${LAST_OPENED_KEY}:${userId ?? "anon"}:${workspaceId}`;
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * Tolerant decode. Accepts the 2026-10-05 shape (a bare ontology id) so a value
 * written by that build is not lost; anything malformed reads as no memory.
 */
export function parseMemory(raw: string | null): OntologyMemory {
  if (!raw) return EMPTY;
  if (!raw.startsWith("{")) return { ...EMPTY, ontologyId: raw };
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const objects: Record<string, string> = {};
    if (v.objects && typeof v.objects === "object") {
      for (const [k, id] of Object.entries(v.objects as Record<string, unknown>)) {
        if (isId(k) && isId(id)) objects[k] = id;
      }
    }
    return {
      ontologyId: isId(v.ontologyId) ? v.ontologyId : null,
      face: v.face === "changelog" ? "changelog" : "board",
      objects,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * This device's memory for the pair; EMPTY when none. Every `localStorage` touch
 * is guarded: it throws in a private window and with site data blocked, and is
 * absent in the SSR pass.
 */
export function readMemory(
  userId: string | undefined,
  workspaceId: string
): OntologyMemory {
  if (typeof window === "undefined") return EMPTY;
  try {
    return parseMemory(window.localStorage.getItem(storageKey(userId, workspaceId)));
  } catch {
    return EMPTY;
  }
}

/** Read-modify-write. Swallows every storage failure: remembering is a convenience. */
function update(
  userId: string | undefined,
  workspaceId: string,
  change: (m: OntologyMemory) => OntologyMemory
): void {
  if (typeof window === "undefined") return;
  try {
    const key = storageKey(userId, workspaceId);
    const next = change(parseMemory(window.localStorage.getItem(key)));
    if (next.ontologyId === null && next.face === "board" && !Object.keys(next.objects).length) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // failing to remember is not an error state
  }
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
      objects: without(m.objects, ontologyId),
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
    const rest = without(m.objects, ontologyId);
    if (objectId === null) return { ...m, objects: rest };
    const entries = Object.entries(rest);
    const kept = entries.slice(Math.max(0, entries.length - (MAX_REMEMBERED_OBJECTS - 1)));
    return { ...m, objects: { ...Object.fromEntries(kept), [ontologyId]: objectId } };
  });
}

function without(
  objects: Readonly<Record<string, string>>,
  key: string
): Record<string, string> {
  return Object.fromEntries(Object.entries(objects).filter(([k]) => k !== key));
}

/** Forget the whole pair. */
export function clearLastOpened(userId: string | undefined, workspaceId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(userId, workspaceId));
  } catch {
    // Already unreachable; the caller's fallback does the rest.
  }
}
