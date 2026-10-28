/**
 * The staging twin of `ontology/server/service-revisions.ts` (server-only, so it
 * cannot be imported): diff two graph states and file the revision rows the
 * server would — one per moved field, a bundle per create/delete — so the History
 * section and the Changelog face move as the board is edited.
 */

import type { GraphState } from "@/features/ontology/graph-state";
import { isPendingOntologyId } from "@/features/ontology/optimistic-create";
import type { OntologyObject } from "@/features/ontology/types";
import { makeRevision, type StagedRevision } from "../data/demo-revisions";

/** `service-revisions.ts › objectFields`, restated. */
function objectFields(o: OntologyObject): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    name: o.name,
    subtitle: o.subtitle,
    methods: o.methods ?? [],
    template: o.template ?? [],
  };
  for (const a of o.attributes ?? []) fields[`attribute:${a.key}`] = a.value;
  return fields;
}

const stable = (v: unknown) => JSON.stringify(v ?? null);

function ownerMap(state: GraphState): Map<string, string> {
  const owner = new Map<string, string>();
  const walk = (ontologyId: string, id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (!owner.has(id)) owner.set(id, ontologyId);
    for (const child of state.objects[id]?.childIds ?? []) walk(ontologyId, child, seen);
  };
  for (const o of state.ontologies) {
    const seen = new Set<string>();
    for (const col of o.columnIds) walk(o.id, col, seen);
  }
  return owner;
}

export function diffGraphs(
  before: GraphState,
  after: GraphState,
  restoreMarks: ReadonlySet<string>
): StagedRevision[] {
  if (before === after) return [];
  const now = new Date().toISOString();
  const out: StagedRevision[] = [];
  const ownersAfter = ownerMap(after);
  const ownersBefore = ownerMap(before);

  for (const o of after.ontologies) {
    if (isPendingOntologyId(o.id)) continue;
    const prev = before.ontologies.find((p) => p.id === o.id);
    const res = { type: "ontology" as const, id: o.id };
    if (!prev) {
      out.push(makeRevision(o.id, res, "create", {
        fields: { name: o.name, purpose: o.purpose, agentsMayEdit: o.agentsMayEdit ?? true },
      }, now));
      continue;
    }
    for (const f of ["name", "purpose", "agentsMayEdit"] as const) {
      if (stable(prev[f]) !== stable(o[f])) {
        out.push(makeRevision(o.id, res, f === "name" ? "rename" : "edit", {
          field: f, before: prev[f] ?? null, after: o[f] ?? null,
        }, now));
      }
    }
  }

  for (const [id, obj] of Object.entries(after.objects)) {
    if (isPendingOntologyId(id)) continue;
    const ontologyId = ownersAfter.get(id);
    if (!ontologyId) continue;
    const res = { type: "ontology_object" as const, id };
    const prev = before.objects[id];
    if (!prev) {
      out.push(makeRevision(ontologyId, res, "create", { fields: objectFields(obj) }, now));
      continue;
    }
    const a = objectFields(prev);
    const b = objectFields(obj);
    for (const field of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const from = field in a ? a[field] : null;
      const to = field in b ? b[field] : null;
      if (stable(from) === stable(to)) continue;
      const op = restoreMarks.has(`${id}|${field}`)
        ? "restore"
        : field === "name"
          ? "rename"
          : "edit";
      out.push(makeRevision(ontologyId, res, op, { field, before: from, after: to }, now));
    }
    if (stable(prev.relationships) !== stable(obj.relationships)) {
      out.push(makeRevision(ontologyId, res, "edit", {
        association: "relationship",
        field: "relationship",
        before: prev.relationships,
        after: obj.relationships,
      }, now));
    }
  }

  for (const [id, prev] of Object.entries(before.objects)) {
    if (after.objects[id] || isPendingOntologyId(id)) continue;
    const ontologyId = ownersBefore.get(id);
    if (!ontologyId || !after.ontologies.some((o) => o.id === ontologyId)) continue;
    out.push(makeRevision(ontologyId, { type: "ontology_object", id }, "delete", {
      fields: objectFields(prev),
    }, now));
  }
  return out;
}
