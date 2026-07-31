/**
 * `dopl_ontology` op dispatch + mutating handlers. `dispatch` is the whole
 * tool's switch: it validates required params, routes the read ops to
 * ontology-ops-read.ts, and handles every write inline (cluster/column/
 * object creation, attribute/relationship/action/template upserts,
 * claim_anchor). The value resolvers (refs → ids, knowledge/skill refs →
 * ids, entry refs) and the optimistic-concurrency `withObject` wrapper live
 * here too. The registrar (ontology.ts) wires this to the tool.
 */

import type {
  DoplClient,
  OntologyObject,
  OntologySnapshot,
} from "@dopl/client";
import { inlineOr } from "./narration";
import { err, isConflict, missingParams, ok, type ToolResponse } from "./respond";
import { resolveClusterRef, resolveObjectRef } from "./ontology-render";
import { opAnchor, opGet, opMap, opResolve } from "./ontology-ops-read";

/**
 * Write confirmations read the STORED name back — the server canonicalises it,
 * and on `create_object` the fields listed are copied from the PARENT, which
 * another member authored. Same rule as the read side: a name is a value.
 */
const NO_NAME = "`(unnamed)`";

export interface OntologyArgs {
  op: string;
  query?: string;
  object?: string;
  cluster?: string;
  parent?: string;
  name?: string;
  purpose?: string;
  subtitle?: string;
  label?: string;
  kind?: "text" | "pill" | "ref" | "knowledge" | "skill";
  value?: string;
  values?: string[];
  targets?: string[];
  description?: string;
  outcome?: string;
  tools?: string;
  expected_version?: string;
}

// Attribute-value size caps, mirrored from the server schema
// (attributeValueSchema) so an oversized value fails with a clear,
// field-named message at the tool boundary instead of an opaque
// downstream VALIDATION_FAILED.
const TEXT_VALUE_MAX = 4000;
const PILL_VALUE_MAX = 400;

const REQUIRED: Record<string, string[]> = {
  resolve: ["query"],
  get: ["object"],
  create_cluster: ["name"],
  update_cluster: ["cluster"],
  restore_cluster: ["cluster"],
  create_column: ["cluster", "name"],
  create_object: ["parent", "name"],
  update_object: ["object"],
  set_template_field: ["object", "label"],
  remove_template_field: ["object", "label"],
  set_attribute: ["object", "label"],
  remove_attribute: ["object", "label"],
  set_relationship: ["object", "label", "targets"],
  remove_relationship: ["object", "label"],
  set_action: ["object", "name"],
  remove_action: ["object", "name"],
  claim_anchor: ["object"],
};

export async function dispatch(client: DoplClient, args: OntologyArgs): Promise<ToolResponse> {
  const required = REQUIRED[args.op];
  if (required) {
    const miss = missingParams(args.op, args as unknown as Record<string, unknown>, required);
    if (miss) return miss;
  }

  switch (args.op) {
    case "map":
      return opMap(client);
    case "anchor":
      return opAnchor(client);
    case "resolve":
      return opResolve(client, args.query as string);
    case "get":
      return opGet(client, args.object as string);
    case "create_cluster": {
      const cluster = await client.createOntologyCluster({
        name: args.name as string,
        purpose: args.purpose,
      });
      return ok(
        `Created cluster ${inlineOr(cluster.name, NO_NAME)} (slug: \`${cluster.slug}\`). Add columns with op="create_column".`
      );
    }
    case "update_cluster": {
      const snapshot = await client.getOntology();
      const resolved = resolveClusterRef(snapshot, args.cluster as string);
      if ("fail" in resolved) return resolved.fail;
      const cluster = await client.updateOntologyCluster(resolved.hit.id, {
        name: args.name,
        purpose: args.purpose,
      });
      return ok(`Updated cluster ${inlineOr(cluster.name, NO_NAME)} (slug: \`${cluster.slug}\`).`);
    }
    case "restore_cluster": {
      // A trashed cluster is absent from the snapshot (reads exclude
      // soft-deleted), so it can't be resolved here — pass the ref straight
      // through and let the server find the tombstone by id/slug.
      const cluster = await client.restoreOntologyCluster(args.cluster as string);
      return ok(
        `Restored cluster ${inlineOr(cluster.name, NO_NAME)} (slug: \`${cluster.slug}\`) and the objects its delete cascaded. Run op="map" to verify.`
      );
    }
    case "create_column": {
      const snapshot = await client.getOntology();
      const resolved = resolveClusterRef(snapshot, args.cluster as string);
      if ("fail" in resolved) return resolved.fail;
      const column = await client.createOntologyObject({
        clusterId: resolved.hit.id,
        name: args.name as string,
      });
      return ok(
        `Created column ${inlineOr(column.name, NO_NAME)} (id: \`${column.id}\`) in ${inlineOr(resolved.hit.name, NO_NAME)}. Add objects with op="create_object" parent="${column.id}".`
      );
    }
    case "create_object": {
      const snapshot = await client.getOntology();
      const resolved = resolveObjectRef(snapshot, args.parent as string);
      if ("fail" in resolved) return resolved.fail;
      // Template fields, relationships, and actions copy from the parent.
      const object = await client.createOntologyObject({
        parentObjectId: resolved.hit.id,
        name: args.name as string,
      });
      const born: string[] = [];
      if (object.attributes.length) {
        born.push(
          `fields ${object.attributes.map((a) => inlineOr(a.label, NO_NAME)).join(", ")}`,
        );
      }
      if (object.relationships.length) born.push(`${object.relationships.length} relationship(s)`);
      if (object.methods.length) born.push(`${object.methods.length} action(s)`);
      const bornNote = born.length ? ` Born with ${born.join(" · ")}.` : "";
      return ok(
        `Created ${inlineOr(object.name, NO_NAME)} (id: \`${object.id}\`) inside ${inlineOr(resolved.hit.name, NO_NAME)}.${bornNote}`
      );
    }
    case "update_object":
      return withObject(client, args.object as string, async (object) => {
        await client.updateOntologyObject(
          object.id,
          { name: args.name, subtitle: args.subtitle },
          args.expected_version
        );
        return ok(`Updated ${inlineOr(args.name ?? object.name, NO_NAME)} (\`${object.id}\`).`);
      });
    case "set_template_field":
      return withObject(client, args.object as string, async (object) => {
        const label = (args.label as string).trim();
        if (!label) return err("set_template_field needs a non-empty `label`.");
        const kind = args.kind ?? "text";
        const needle = label.toLowerCase();
        const current = object.template ?? [];
        const existing = current.find((f) => f.label.toLowerCase() === needle);
        const field = {
          key: existing?.key ?? label.toLowerCase().replace(/\s+/g, "-"),
          label,
          kind,
        };
        const template = existing
          ? current.map((f) => (f === existing ? field : f))
          : [...current, field];
        await client.updateOntologyObject(object.id, { template }, args.expected_version);
        return ok(
          `Set default field ${inlineOr(label, NO_NAME)} (${kind}) on ${inlineOr(object.name, NO_NAME)} — new objects created inside it are born with it, empty. Fields now: ${template.map((f) => inlineOr(f.label, NO_NAME)).join(", ")}.`
        );
      });
    case "remove_template_field":
      return withObject(client, args.object as string, async (object) => {
        const needle = (args.label as string).toLowerCase();
        const current = object.template ?? [];
        const template = current.filter((f) => f.label.toLowerCase() !== needle);
        if (template.length === current.length) {
          return err(
            `${inlineOr(object.name, NO_NAME)} has no default field ${inlineOr(args.label, NO_NAME)}.`,
          );
        }
        await client.updateOntologyObject(object.id, { template }, args.expected_version);
        return ok(
          `Removed default field ${inlineOr(args.label, NO_NAME)} from ${inlineOr(object.name, NO_NAME)}.`,
        );
      });
    case "set_attribute":
      return opSetAttribute(client, args);
    case "remove_attribute":
      return withObject(client, args.object as string, async (object) => {
        const label = (args.label as string).toLowerCase();
        const attributes = object.attributes.filter(
          (a) => a.label.toLowerCase() !== label
        );
        if (attributes.length === object.attributes.length) {
          return err(
            `${inlineOr(object.name, NO_NAME)} has no attribute ${inlineOr(args.label, NO_NAME)}.`,
          );
        }
        await client.updateOntologyObject(object.id, { attributes }, args.expected_version);
        return ok(
          `Removed attribute ${inlineOr(args.label, NO_NAME)} from ${inlineOr(object.name, NO_NAME)}.`,
        );
      });
    case "set_relationship":
    case "remove_relationship":
      return opSetRelationship(client, args);
    case "set_action":
      return withObject(client, args.object as string, async (object) => {
        const name = (args.name as string).trim();
        const needle = name.toLowerCase();
        const existing = object.methods.find((m) => m.name.toLowerCase() === needle);
        const method = {
          name,
          description: args.description ?? existing?.description ?? "",
          outcome: args.outcome ?? existing?.outcome ?? "",
          tools: args.tools ?? existing?.tools ?? "",
        };
        const methods = existing
          ? object.methods.map((m) => (m === existing ? method : m))
          : [...object.methods, method];
        await client.updateOntologyObject(object.id, { methods }, args.expected_version);
        return ok(`Set action ${inlineOr(name, NO_NAME)} on ${inlineOr(object.name, NO_NAME)}.`);
      });
    case "remove_action":
      return withObject(client, args.object as string, async (object) => {
        const needle = (args.name as string).toLowerCase();
        const methods = object.methods.filter((m) => m.name.toLowerCase() !== needle);
        if (methods.length === object.methods.length) {
          return err(
            `${inlineOr(object.name, NO_NAME)} has no action ${inlineOr(args.name, NO_NAME)}.`,
          );
        }
        await client.updateOntologyObject(object.id, { methods }, args.expected_version);
        return ok(
          `Removed action ${inlineOr(args.name, NO_NAME)} from ${inlineOr(object.name, NO_NAME)}.`,
        );
      });
    case "claim_anchor":
      return withObject(client, args.object as string, async (object) => {
        await client.claimOntologyAnchor(object.id);
        return ok(
          `Anchored the calling user to ${inlineOr(object.name, NO_NAME)} (\`${object.id}\`). op="anchor" now resolves to it.`
        );
      });
    default:
      return err(`Unknown op ${inlineOr(args.op, "`(unreadable)`")}.`);
  }
}

async function withObject(
  client: DoplClient,
  ref: string,
  fn: (object: OntologyObject, snapshot: OntologySnapshot) => Promise<ToolResponse>
): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  const resolved = resolveObjectRef(snapshot, ref);
  if ("fail" in resolved) return resolved.fail;
  try {
    return await fn(resolved.hit, snapshot);
  } catch (e) {
    // Optimistic-concurrency miss (412): the object changed between the
    // caller's op="get" and this write. Turn it into re-get/reconcile/retry
    // guidance (mirrors dopl_kb write_file), not an opaque throw.
    if (isConflict(e)) {
      return err(
        `${inlineOr(resolved.hit.name, NO_NAME)} (\`${resolved.hit.id}\`) changed since you last read it. Re-read it with op="get", reconcile your change, then retry with the fresh Version as \`expected_version\` (or omit expected_version to overwrite blindly).`
      );
    }
    throw e;
  }
}

async function opSetAttribute(client: DoplClient, args: OntologyArgs): Promise<ToolResponse> {
  return withObject(client, args.object as string, async (object, snapshot) => {
    const label = (args.label as string).trim();
    const kind = args.kind ?? "text";

    let value: OntologyObject["attributes"][number]["value"];
    if (kind === "text" || kind === "pill") {
      if (args.value === undefined) {
        return err(`set_attribute kind="${kind}" needs \`value\`.`);
      }
      const cap = kind === "pill" ? PILL_VALUE_MAX : TEXT_VALUE_MAX;
      if (args.value.length > cap) {
        return err(
          `set_attribute kind="${kind}" value for ${inlineOr(label, NO_NAME)} is ${args.value.length} characters; the max is ${cap}. Shorten it, use kind="text" for longer prose, or link a knowledge entry instead.`
        );
      }
      value = { kind, value: args.value };
    } else {
      if (!args.values?.length) {
        return err(`set_attribute kind="${kind}" needs \`values\` (at least one).`);
      }
      const resolved =
        kind === "ref"
          ? resolveObjectValues(snapshot, args.values)
          : await resolveResourceValues(client, kind, args.values);
      if ("fail" in resolved) return resolved.fail;
      value = { kind, value: resolved.ids };
    }

    const needle = label.toLowerCase();
    const attribute = {
      key: label.toLowerCase().replace(/\s+/g, "-"),
      label,
      value,
    };
    const existing = object.attributes.findIndex(
      (a) => a.label.toLowerCase() === needle
    );
    const attributes =
      existing >= 0
        ? object.attributes.map((a, i) => (i === existing ? attribute : a))
        : [...object.attributes, attribute];
    await client.updateOntologyObject(object.id, { attributes }, args.expected_version);
    return ok(`Set attribute ${inlineOr(label, NO_NAME)} on ${inlineOr(object.name, NO_NAME)}.`);
  });
}

async function opSetRelationship(client: DoplClient, args: OntologyArgs): Promise<ToolResponse> {
  return withObject(client, args.object as string, async (object, snapshot) => {
    const label = (args.label as string).trim();
    const needle = label.toLowerCase();
    const kept = object.relationships.filter((r) => r.label.toLowerCase() !== needle);

    if (args.op === "remove_relationship") {
      if (kept.length === object.relationships.length) {
        return err(
          `${inlineOr(object.name, NO_NAME)} has no relationship ${inlineOr(label, NO_NAME)}.`,
        );
      }
      await client.updateOntologyObject(
        object.id,
        { relationships: kept },
        args.expected_version
      );
      return ok(
        `Removed relationship ${inlineOr(label, NO_NAME)} from ${inlineOr(object.name, NO_NAME)}.`,
      );
    }

    // F-19: an empty targets array slips past the required-param check (which
    // only rejects undefined/null/empty-string) but persists nothing — the
    // server drops zero-target edges. Reject it with the same shape as
    // set_attribute kind="ref".
    if (!args.targets?.length) {
      return err(
        `set_relationship needs \`targets\` (at least one object). To clear ${inlineOr(label, NO_NAME)}, use op="remove_relationship".`
      );
    }

    const resolved = resolveObjectValues(snapshot, args.targets);
    if ("fail" in resolved) return resolved.fail;
    // F-20: a self-edge is silently dropped server-side, so it would report a
    // false success. Reject explicitly rather than persist nothing.
    if (resolved.ids.includes(object.id)) {
      return err("Cannot relate an object to itself.");
    }
    const relationships = [...kept, { label, targetIds: resolved.ids }];
    await client.updateOntologyObject(object.id, { relationships }, args.expected_version);
    const names = resolved.ids.map((id) =>
      snapshot.objects[id] ? inlineOr(snapshot.objects[id].name, NO_NAME) : `\`${id}\``,
    );
    return ok(
      `Set ${inlineOr(object.name, NO_NAME)} —${inlineOr(label, NO_NAME)}→ ${names.join(", ")}.`,
    );
  });
}

function resolveObjectValues(
  snapshot: OntologySnapshot,
  refs: string[]
): { ids: string[] } | { fail: ToolResponse } {
  const ids: string[] = [];
  for (const ref of refs) {
    const resolved = resolveObjectRef(snapshot, ref);
    if ("fail" in resolved) return resolved;
    if (!ids.includes(resolved.hit.id)) ids.push(resolved.hit.id);
  }
  return { ids };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveResourceValues(
  client: DoplClient,
  kind: "knowledge" | "skill",
  refs: string[]
): Promise<{ ids: string[] } | { fail: ToolResponse }> {
  const resources =
    kind === "knowledge"
      ? (await client.listKbBases().catch(() => [])).map((b) => ({
          id: b.id,
          slug: b.slug,
          name: b.name,
        }))
      : (await client.listSkills().catch(() => [])).map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
        }));
  const ids: string[] = [];
  for (const ref of refs) {
    const needle = ref.toLowerCase();
    const hit = resources.find(
      (r) => r.id === ref || r.slug === needle || r.name.toLowerCase() === needle
    );
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
      continue;
    }
    if (kind === "knowledge") {
      const entry = await resolveKbEntryRef(client, resources, ref);
      if ("fail" in entry) return entry;
      if (entry.id) {
        if (!ids.includes(entry.id)) ids.push(entry.id);
        continue;
      }
    }
    const known = resources.map((r) => inlineOr(r.slug, NO_NAME)).join(", ") || "none";
    const entryHint =
      kind === "knowledge"
        ? ` For a specific entry, pass \`<base>/<entry path>\` or the entry's uuid.`
        : "";
    return {
      fail: err(
        `No ${kind === "knowledge" ? "knowledge base" : "skill"} ${inlineOr(ref, NO_NAME)}. Available: ${known}.${entryHint}`
      ),
    };
  }
  return { ids };
}

/**
 * Entry-level knowledge refs: `<base>/<entry path>` (base by id/slug/name)
 * or a bare entry uuid, hunted across the caller's accessible bases.
 * Returns `{ id: null }` when the ref simply doesn't match an entry, so
 * the caller can fall through to its "no such base" error.
 */
async function resolveKbEntryRef(
  client: DoplClient,
  bases: Array<{ id: string; slug: string; name: string }>,
  ref: string
): Promise<{ id: string | null } | { fail: ToolResponse }> {
  const slash = ref.indexOf("/");
  if (slash > 0) {
    const baseRef = ref.slice(0, slash);
    const path = ref.slice(slash + 1);
    const needle = baseRef.toLowerCase();
    const base = bases.find(
      (b) => b.id === baseRef || b.slug === needle || b.name.toLowerCase() === needle
    );
    if (!base || !path) return { id: null };
    try {
      const entry = await client.readKbFileByPath(base.id, path);
      return { id: entry.id };
    } catch {
      return {
        fail: err(
          `No entry at ${inlineOr(path, NO_NAME)} in knowledge base \`${base.slug}\`. Check the path with dopl_kb op="get_tree" base="${base.slug}".`
        ),
      };
    }
  }
  if (!UUID_RE.test(ref)) return { id: null };
  const trees = await Promise.all(
    bases.map((b) => client.getKbTree(b.id).catch(() => null))
  );
  for (const tree of trees) {
    if (tree?.entries.some((e) => e.id === ref)) return { id: ref };
  }
  return { id: null };
}
