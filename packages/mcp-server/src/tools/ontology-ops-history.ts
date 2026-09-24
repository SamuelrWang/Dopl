/**
 * `dopl_ontology` op="history" and op="restore" (DMP-002, 2026-09-23). History is PER FIELD — one
 * row per changed field, the app Changelog's granularity — for one object (`object=`) or an
 * ontology's roll-up (`ontology=`). Restore targets one OBJECT.
 *
 * ⚠ RESTORING A REVISION WRITES ITS `before` BACK — it undoes that change for that one field, and
 * the other fields keep their current values. Every row prints `before → after`, so the preview
 * is the row itself. Link, create and delete rows are listed and refused on restore (the server's
 * `REVISION_NOT_RESTORABLE`).
 * ⚠ `restore` REQUIRES `expected_version` and checks it here and atomically in the route.
 */

import type { ContentRevision, DoplClient, OntologyObject } from "@dopl/client";
import { inlineOr, NO_NAME } from "./narration";
import { ok, type ToolResponse } from "./respond";
import { resolveOntologyRef, resolveObjectRef } from "./ontology-render";
import {
  pageTail,
  restoreRefusal,
  revisionRow,
  staleBeforeRestore,
} from "./revision-render";

/** Rows per page; the route's own max is 200. */
const ONTOLOGY_HISTORY_PAGE = 30;
/** A value is DATA a member typed: shown clipped and neutralized, never whole. */
const VALUE_MAX = 80;

function valueOf(v: unknown): string {
  if (v === null || v === undefined) return "`(none)`";
  const raw = typeof v === "string" ? v : JSON.stringify(v);
  const clipped = raw.length > VALUE_MAX ? `${raw.slice(0, VALUE_MAX)}…` : raw;
  return inlineOr(clipped, "`(unreadable)`");
}

/** What changed: `field: before → after`, or the kind of row it is when it holds no field. */
function changeOf(rev: ContentRevision, onObject: boolean): string {
  const where = onObject ? "" : ` · on \`${rev.resourceId}\``;
  const p = rev.payload;
  if (p.association) return `${where} · ${p.association} link`;
  if (p.field) return `${where} · ${inlineOr(p.field, "`(field)`")}: ${valueOf(p.before)} → ${valueOf(p.after)}`;
  return where;
}

export async function opHistory(
  client: DoplClient,
  callerUserId: string | null,
  args: { object?: string; ontology?: string },
): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  if (args.object !== undefined) {
    const resolved = resolveObjectRef(snapshot, args.object);
    if ("fail" in resolved) return resolved.fail;
    const object = resolved.hit;
    const page = await client.listOntologyObjectRevisions(object.id, { limit: ONTOLOGY_HISTORY_PAGE });
    return ok(render(`${inlineOr(object.name, NO_NAME)} (id \`${object.id}\`)`, object, page, callerUserId, true));
  }
  const resolved = resolveOntologyRef(snapshot, args.ontology as string);
  if ("fail" in resolved) return resolved.fail;
  const page = await client.listOntologyRevisions(resolved.hit.id, { limit: ONTOLOGY_HISTORY_PAGE });
  return ok(render(`ontology ${inlineOr(resolved.hit.name, NO_NAME)}`, null, page, callerUserId, false));
}

function render(
  title: string,
  object: OntologyObject | null,
  page: { revisions: ContentRevision[]; nextCursor: string | null },
  callerUserId: string | null,
  onObject: boolean,
): string {
  const lines = [`# History: ${title}`];
  if (object?.updatedAt) lines.push(`Current: Version \`${object.updatedAt}\`.`);
  lines.push("");
  if (page.revisions.length === 0) lines.push("_No revisions recorded._");
  for (const rev of page.revisions) lines.push(revisionRow(rev, callerUserId, changeOf(rev, onObject)));
  lines.push(
    "",
    page.nextCursor ? `Newest ${page.revisions.length} shown; narrow with object= for one item's full trail.` : pageTail(null, ""),
    `Restore writes a row's BEFORE value back, one field: op="restore" object="<id>" revision="<id>" expected_version="<Version from op=get>".`,
  );
  return lines.join("\n");
}

export async function opRestore(
  client: DoplClient,
  args: { object: string; revision: string; expected_version: string },
): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  const resolved = resolveObjectRef(snapshot, args.object);
  if ("fail" in resolved) return resolved.fail;
  const object = resolved.hit;
  if (object.updatedAt && object.updatedAt !== args.expected_version) {
    return staleBeforeRestore('op="get"', object.updatedAt, args.expected_version);
  }
  let restored: OntologyObject;
  try {
    restored = await client.restoreOntologyObjectRevision(object.id, args.revision, args.expected_version);
  } catch (e) {
    const mapped = restoreRefusal(e, 'op="get"', 'op="history"');
    if (mapped) return mapped;
    throw e;
  }
  return ok(
    [
      `Restored one field of ${inlineOr(restored.name, NO_NAME)} (id \`${restored.id}\`) from revision \`${args.revision}\` — written as a NEW revision; every other field kept its current value.`,
      `Version \`${args.expected_version}\` → \`${restored.updatedAt ?? "(not reported)"}\`. Read the result with op="get".`,
    ].join("\n"),
  );
}
