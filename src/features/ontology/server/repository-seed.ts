import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { OntologyObject } from "../types";
import {
  ONTOLOGY_OBJECT_COLS,
  type OntologyObjectRow,
} from "./dto";
import { stripNullBytes } from "./repository";

/**
 * BULK write I/O — set-at-a-time forms of the single-row writes in
 * `./repository.ts`. Separate module because they serve a different caller:
 * `repository.ts` is the API/MCP create-update surface (one gesture, one row);
 * these serve the new-workspace seed, which materialises a whole authored graph
 * in front of the post-signup redirect.
 *
 * Same conventions as `repository.ts`: no business logic, no auth checks, every
 * row carries `workspace_id` explicitly (service-role bypasses RLS).
 */

/**
 * Insert many objects in ONE statement, every column set at insert time.
 * `insertObject` stays narrow (name + attributes/methods) because that IS the
 * API/MCP create surface; this is the seed's bulk form.
 *
 * `id` is caller-supplied so memberships/relationships referencing these
 * objects can be built before the insert resolves — no dependence on
 * `RETURNING` order, no second pass.
 */
export async function insertObjects(
  inputs: Array<{
    id: string;
    workspaceId: string;
    name: string;
    createdBy: string;
    subtitle?: string;
    attributes?: OntologyObject["attributes"];
    methods?: OntologyObject["methods"];
    template?: OntologyObject["template"];
  }>
): Promise<OntologyObjectRow[]> {
  if (inputs.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .insert(
      inputs.map((input) =>
        stripNullBytes({
          id: input.id,
          workspace_id: input.workspaceId,
          name: input.name,
          created_by: input.createdBy,
          ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
          ...(input.attributes?.length ? { attributes: input.attributes } : {}),
          ...(input.methods?.length ? { methods: input.methods } : {}),
          ...(input.template?.length ? { template: input.template } : {}),
        })
      )
    )
    .select(ONTOLOGY_OBJECT_COLS);
  if (error) throw error;
  return (data ?? []) as OntologyObjectRow[];
}


/** Insert many memberships in ONE statement (new-workspace seed). */
export async function insertMemberships(
  inputs: Array<{
    workspaceId: string;
    clusterId: string | null;
    parentObjectId: string | null;
    childObjectId: string;
    position: number;
  }>
): Promise<void> {
  if (inputs.length === 0) return;
  const db = supabaseAdmin();
  const { error } = await db.from("ontology_memberships").insert(
    inputs.map((input) => ({
      workspace_id: input.workspaceId,
      cluster_id: input.clusterId,
      parent_object_id: input.parentObjectId,
      child_object_id: input.childObjectId,
      position: input.position,
    }))
  );
  if (error) throw error;
}


/**
 * Insert many relationships in ONE statement. ⚠ Not
 * `replaceRelationshipsForSource` — that is a replace-set (delete + insert per
 * source object). This is the ADD form, for a caller that knows nothing exists
 * yet (the seed's objects were created moments earlier in the same call).
 */
export async function insertRelationships(
  workspaceId: string,
  edges: Array<{
    sourceObjectId: string;
    label: string;
    targetObjectId: string;
    position: number;
  }>
): Promise<void> {
  if (edges.length === 0) return;
  const db = supabaseAdmin();
  const { error } = await db.from("ontology_relationships").insert(
    edges.map((edge) =>
      stripNullBytes({
        workspace_id: workspaceId,
        source_object_id: edge.sourceObjectId,
        label: edge.label,
        target_object_id: edge.targetObjectId,
        position: edge.position,
      })
    )
  );
  if (error) throw error;
}

