/**
 * Shared resolvers + renderers for the `dopl_ontology` tool. Refs are
 * agent-friendly: ids preferred, exact names accepted (ambiguity is an
 * error listing candidates, never a guess).
 */

import type { DoplClient, OntologyObject, OntologySnapshot } from "@dopl/client";
import { isConcise, type ResponseFormat } from "./response-size";
import { inlineOr, NO_NAME } from "./narration";
import { err, type ToolResponse } from "./respond";
// ⚠ ONE TABLE FOR BOTH LANES — `container-destination.ts` owns the destination
// wording, and the knowledge lane reads its own headings from the same place.
// Two hand-typed copies is how an agent ends up holding a sharing model the
// operator does not have.
import { DESTINATION_HEADINGS } from "./container-destination";

/*
 * ⚠ THE VALUE/BODY LINE, DRAWN TWICE. The graph is workspace-scoped and nothing
 * in `features/ontology/schema.ts` carries a charset rule (object `name`
 * max 300, `subtitle` max 1000, attribute `label` max 200, method `name`
 * max 300), so newlines and `##` are legal in all of them.
 *
 *   - NAMES and LABELS are VALUES → neutralized. Note the "kind" in a headline
 *     is not server-assigned: it is the CONTAINING OBJECT'S NAME.
 *   - PROSE the agent must act on is NOT neutralized — a `text` attribute value
 *     (4000 chars) and an action's description / outcome / tools are the
 *     routing instructions the ontology exists to carry, and clipping them to
 *     160 chars deletes the feature. {@link indented} instead: a newline can no
 *     longer put attacker text at the START of a line.
 *
 * The fallback itself is `narration.ts › NO_NAME` (2026-09-17).
 */

/**
 * Multi-line prose under the line introducing it, continuations indented two
 * spaces. ⚠ Content survives verbatim; it loses only the ability to BEGIN a line.
 */
function indented(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join("\n");
}

/**
 * ⚠ §8 STALE-CACHE, SPELLED INLINE, AND **ONE FROZEN EMPTY RATHER THAN TWO**.
 * A payload cached against a server older than S29c carries no
 * `personalOntologyIds`, and this is what the absent key falls back to: no row is
 * filed under the personal label, which is the reading that states nothing the
 * response did not measure. The knowledge lane's twin is
 * `knowledge-ops-read.ts › EMPTY_BASE_IDS`.
 */
const EMPTY_ONTOLOGY_IDS: readonly string[] = Object.freeze([]);

/**
 * 🔒 **THE PERSONAL SHELF, LABELLED ON THE ONTOLOGY LANE** (S29c, 2026-09-18).
 *
 * ⚠ **THE COMPLAINT THIS ANSWERS.** A BRAND-NEW home channel listed two
 * ontologies nobody had put there, with nothing saying where they came from —
 * `createHomeChannel` seeds none, and what is actually happening is that
 * `service-audience.ts › computeAudience` folds the caller's own personal shelf
 * into the read scope, exactly as the knowledge lane does. The KB lane labels
 * its half `container-destination.ts › DESTINATION_HEADINGS.personal`; the
 * ontology lane rendered the widening and never named it, which is how two rows
 * a caller owns read as two rows a caller must go and investigate.
 *
 * ⚠ **THE SPLIT KEYS ON THE ANSWER, NOT ON THE QUESTION**, the same rule
 * `opListBases` states: an ABSENT key means "not answered" and puts every
 * ontology in the unlabelled group, which is byte-identical to what this render
 * did before the field existed. It never files a row under a shelf it did not
 * measure.
 *
 * ⚠ **THE HEADING IS A FACT, SO IT SURVIVES `concise`** — which container a row
 * lives in is not a legend, and the whole point of the label is that a reader
 * is wrong without it.
 *
 * @returns the two groups in render order; the personal one carries the shared
 *          heading text, the other carries `null` (no heading at all).
 */
export function personalShelfGroups<T extends { id: string }>(
  ontologies: readonly T[],
  personalOntologyIds: readonly string[] | undefined,
): Array<readonly [string | null, readonly T[]]> {
  const shelf = new Set(personalOntologyIds ?? EMPTY_ONTOLOGY_IDS);
  if (shelf.size === 0) return [[null, ontologies]];
  const personal = ontologies.filter((c) => shelf.has(c.id));
  const here = ontologies.filter((c) => !shelf.has(c.id));
  if (personal.length === 0) return [[null, here]];
  return [
    [null, here],
    [DESTINATION_HEADINGS.personal, personal],
  ];
}

export type Resolved<T> = { hit: T } | { fail: ToolResponse };

/**
 * ⚠ THE TWO RESOLVERS TAKE THE SUMMARY SHAPE AND HAND BACK WHAT THEY WERE
 * GIVEN. They match on ids, slugs and names and walk `childIds` for a container
 * name — all carried by the cheap `view: "summary"` projection, so requiring
 * `OntologySnapshot` would force a names-only caller to fetch every JSONB
 * column just to typecheck.
 *
 * ⚠ GENERIC, not merely widened: `resolveObjectRef` feeds the DETAIL path
 * (`op="get"` reads `attributes`/`relationships`/`template`/`methods` off the
 * hit, and every write op passes it to `renderObject`), so a non-generic
 * widening strips those fields off the TYPE. {@link renderObject} keeps its
 * `OntologySnapshot` parameter for the same reason — it reads the heavy fields.
 */
export interface ObjectRefFields {
  id: string;
  name: string;
  childIds: string[];
}

export interface OntologyRefFields {
  id: string;
  slug: string;
  name: string;
}

export function resolveObjectRef<T extends ObjectRefFields>(
  snapshot: { objects: Record<string, T> },
  ref: string
): Resolved<T> {
  const byId = snapshot.objects[ref];
  if (byId) return { hit: byId };
  const needle = ref.toLowerCase();
  const matches = Object.values(snapshot.objects).filter(
    (o) => o.name.toLowerCase() === needle
  );
  if (matches.length === 1) return { hit: matches[0] };
  if (matches.length > 1) {
    const containerOf = (id: string) => {
      const name = Object.values(snapshot.objects).find((o) =>
        o.childIds.includes(id),
      )?.name;
      return name ? inlineOr(name, NO_NAME) : "object";
    };
    const list = matches.map((o) => `\`${o.id}\` (${containerOf(o.id)})`).join(", ");
    return {
      fail: err(
        `Multiple objects named ${inlineOr(ref, NO_NAME)} — use an id: ${list}`,
      ),
    };
  }
  return {
    fail: err(
      `No object ${inlineOr(ref, NO_NAME)}. Find ids with op="resolve" or op="map".`,
    ),
  };
}

export function resolveOntologyRef<T extends OntologyRefFields>(
  snapshot: { ontologies: T[] },
  ref: string
): Resolved<T> {
  const needle = ref.toLowerCase();
  const hit = snapshot.ontologies.find(
    (c) => c.id === ref || c.slug === ref || c.name.toLowerCase() === needle
  );
  if (hit) return { hit };
  const known = snapshot.ontologies.map((c) => inlineOr(c.slug, NO_NAME)).join(", ") || "none";
  return {
    fail: err(`No ontology ${inlineOr(ref, NO_NAME)}. Known ontologies: ${known}.`),
  };
}

export type ResourceHandles = Map<
  string,
  | { name: string; slug: string; kind: "kb" | "skill" }
  | { name: string; slug: string; kind: "kb-entry"; path: string }
>;

export async function resolveResourceHandles(
  client: DoplClient,
  object: OntologyObject
): Promise<ResourceHandles> {
  const wanted = new Set(
    object.attributes.flatMap((a) =>
      a.value.kind === "knowledge" || a.value.kind === "skill" ? a.value.value : []
    )
  );
  const handles: ResourceHandles = new Map();
  if (wanted.size === 0) return handles;
  const [bases, skills] = await Promise.all([
    client.listKbBases().catch(() => []),
    client.listSkills().catch(() => []),
  ]);
  for (const b of bases) {
    if (wanted.has(b.id)) handles.set(b.id, { name: b.name, slug: b.slug, kind: "kb" });
  }
  for (const s of skills) {
    if (wanted.has(s.id)) handles.set(s.id, { name: s.name, slug: s.slug, kind: "skill" });
  }
  // Leftover ids are entry-level knowledge refs — hunt them in the accessible
  // bases' trees and return a read_file-addressable path.
  const unresolved = [...wanted].filter((id) => !handles.has(id));
  if (unresolved.length === 0) return handles;
  const trees = await Promise.all(bases.map((b) => client.getKbTree(b.id).catch(() => null)));
  for (const tree of trees) {
    if (!tree) continue;
    const folderById = new Map(tree.folders.map((f) => [f.id, f]));
    for (const entry of tree.entries) {
      if (!unresolved.includes(entry.id)) continue;
      const segments = [entry.title];
      for (
        let folder = entry.folderId ? folderById.get(entry.folderId) : undefined;
        folder;
        folder = folder.parentId ? folderById.get(folder.parentId) : undefined
      ) {
        segments.unshift(folder.name);
      }
      handles.set(entry.id, {
        name: `${tree.base.name} / ${entry.title}`,
        slug: tree.base.slug,
        kind: "kb-entry",
        path: segments.join("/"),
      });
    }
  }
  return handles;
}

export function renderObject(
  object: OntologyObject,
  snapshot: OntologySnapshot,
  headline?: string,
  handles: ResourceHandles = new Map(),
  /** A16: `concise` drops the two LEGENDS below and nothing else. */
  format?: ResponseFormat
): string {
  const nameOf = (id: string) =>
    snapshot.objects[id] ? inlineOr(snapshot.objects[id].name, NO_NAME) : `\`${id}\``;
  // ⚠ What the object IS = its container's NAME (column, or the object it is
  // nested in) — member-typed like any other. Only the "object" fallback is ours.
  const container = Object.values(snapshot.objects).find((o) =>
    o.childIds.includes(object.id)
  );
  const kindLabel = container?.name ? inlineOr(container.name, NO_NAME) : "object";
  const lines: string[] = [];
  if (headline) lines.push(headline, "");
  lines.push(`# ${inlineOr(object.name, NO_NAME)} (${kindLabel} · id: \`${object.id}\`)`);
  if (object.subtitle) lines.push(inlineOr(object.subtitle, ""));
  // ⚠ A TIMESTAMP AND ITS LEGEND — `response-size.ts`'s own list of what
  // `concise` drops opens with "timestamps". A caller that is about to WRITE
  // asks for `detailed`, which is the default.
  if (object.updatedAt && !isConcise(format)) {
    lines.push(
      `Version: \`${object.updatedAt}\` (pass as expected_version to a later write so a concurrent edit can't clobber yours)`
    );
  }

  if (object.attributes.length > 0) {
    lines.push("", "## Attributes");
    for (const attr of object.attributes) {
      lines.push(
        indented(`- ${inlineOr(attr.label, NO_NAME)}: ${renderValue(attr.value, nameOf, handles)}`),
      );
    }
  }

  if (object.relationships.length > 0) {
    lines.push("", "## Relationships");
    for (const rel of object.relationships) {
      lines.push(`- ${inlineOr(rel.label, NO_NAME)}: ${rel.targetIds.map(nameOf).join(", ")}`);
    }
  }

  // Inbound edges ("Referenced by") — without them `get` shows only outbound
  // edges and hides who depends on this object.
  const backlinks: string[] = [];
  for (const other of Object.values(snapshot.objects)) {
    if (other.id === object.id) continue;
    for (const rel of other.relationships) {
      if (rel.targetIds.includes(object.id)) {
        backlinks.push(
          `- ${inlineOr(other.name, NO_NAME)} —${inlineOr(rel.label, NO_NAME)}→ (id: \`${other.id}\`)`,
        );
      }
    }
  }
  if (backlinks.length > 0) {
    lines.push("", "## Referenced by", ...backlinks);
  }

  if ((object.template ?? []).length > 0) {
    lines.push(
      "",
      "## Default fields (template)",
      ...(isConcise(format)
        ? []
        : ["_New objects created inside this one are born with these fields, empty:_"])
    );
    for (const f of object.template) {
      lines.push(`- ${inlineOr(f.label, NO_NAME)} (${f.kind})`);
    }
  }

  if (object.childIds.length > 0) {
    lines.push("", "## Objects inside");
    for (const id of object.childIds) {
      const child = snapshot.objects[id];
      if (child) lines.push(`- ${inlineOr(child.name, NO_NAME)} (id: \`${id}\`)`);
    }
  }

  if (object.methods.length > 0) {
    lines.push("", "## Actions");
    for (const m of object.methods) {
      // ⚠ Action NAME is a heading (neutralize); the three prose fields under
      // it are what the agent must carry out, so they keep their text and lose
      // only the ability to start a line.
      lines.push(`### ${inlineOr(m.name, NO_NAME)}`);
      if (m.description) lines.push(indented(m.description));
      if (m.outcome) {
        lines.push(indented(`Outcome: ${m.outcome}`));
      }
      if (m.tools) {
        lines.push(indented(`Tools: ${m.tools}`));
      }
    }
  }

  return lines.join("\n");
}

function renderValue(
  value: OntologyObject["attributes"][number]["value"],
  nameOf: (id: string) => string,
  handles: ResourceHandles
): string {
  switch (value.kind) {
    // ⚠ A pill is a short label by construction (max 400) → value. A text
    // attribute is 4000 chars of the user's prose → stays whole, and the caller
    // ({@link renderObject}) indents it.
    case "pill":
      return inlineOr(value.value, "—");
    case "text":
      return value.value || "—";
    case "ref":
      return value.value.map(nameOf).join(", ") || "—";
    case "knowledge":
    case "skill":
      return (
        value.value
          .map((id) => {
            const h = handles.get(id);
            if (!h) return id;
            const opener =
              h.kind === "kb"
                ? `dopl_kb op="get_tree" base="${h.slug}"`
                : h.kind === "kb-entry"
                  ? `dopl_kb op="read_file" base="${h.slug}" path="${h.path}"`
                  : `dopl_skill op="get" slug="${h.slug}"`;
            return `${inlineOr(h.name, NO_NAME)} (${opener})`;
          })
          .join(", ") || "—"
      );
  }
}
