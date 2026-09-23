import type {
  AgentIdentity,
  AgentIdentityCreateBody,
  AgentIdentityUpdateBody,
  IdentityField,
  IdentityKnowledgeRef,
  IdentityVisibility,
} from "../client/types";
import { IDENTITY_FIELD_TYPE_DEFAULT } from "../types";
import {
  EMPTY_KNOWLEDGE,
  refToScope,
  sameScopes,
} from "./knowledge-scopes";

/**
 * The editor's form state and the two bodies it becomes — pure, so the payload is testable without a
 * modal. The draft is all strings (a control hands back `""`); the mapping to absent/cleared is here:
 * a create omits empties, a patch sends `null` to clear (model `""` would 400 on `safeLabel`'s min 1).
 */

export interface IdentityDraft {
  name: string;
  description: string;
  instructions: string;
  /** `""` = the runtime's default. */
  model: string;
  /** `""` = no runtime preference (the channel decides). */
  runtime: string;
  fields: IdentityField[];
  visibility: IdentityVisibility;
  /** Plural like the server's set — a single-team draft would drop the rest on save. */
  teamIds: string[];
  /** Attached scopes as resolved refs (a chip needs a label); the bodies send `refToScope` ids. A set. */
  knowledge: IdentityKnowledgeRef[];
}

/**
 * A new identity's draft opens with one blank field row (Samuel's ruling) — a draft fact, not the
 * component's; `cleanFields` drops it again if it is never typed in.
 */
export function emptyDraft(): IdentityDraft {
  return {
    name: "",
    description: "",
    instructions: "",
    model: "",
    runtime: "",
    fields: [{ key: "", value: "", type: IDENTITY_FIELD_TYPE_DEFAULT }],
    visibility: "private",
    teamIds: [],
    knowledge: [],
  };
}

export function draftFromIdentity(identity: AgentIdentity): IdentityDraft {
  return {
    name: identity.name,
    description: identity.description ?? "",
    instructions: identity.instructions ?? "",
    model: identity.model ?? "",
    // §8: a cached row may predate the column.
    runtime: identity.runtime ?? "",
    fields: identity.fields.map((f) => ({
      key: f.key,
      value: f.value,
      // §8: older rows carry no `type`.
      type: f.type ?? IDENTITY_FIELD_TYPE_DEFAULT,
    })),
    visibility: identity.visibility,
    teamIds: [...identity.teamIds],
    // §8 stale-cache fallback, inline.
    knowledge: [...(identity.knowledge ?? EMPTY_KNOWLEDGE)],
  };
}

/** Fields worth sending: a blank key drops the row; a blank value is kept (a legal half-filled form). */
export function cleanFields(fields: ReadonlyArray<IdentityField>): IdentityField[] {
  return (
    fields
      // `type` travels only when it is not `text` — the default is spelled by absence.
      .map((f) => ({
        key: f.key.trim(),
        value: f.value.trim(),
        ...(f.type && f.type !== IDENTITY_FIELD_TYPE_DEFAULT ? { type: f.type } : {}),
      }))
      .filter((f) => f.key !== "")
  );
}

/** Save is refused on a nameless identity; everything else is optional. */
export function isDraftSavable(draft: IdentityDraft): boolean {
  if (draft.name.trim() === "") return false;
  // A Team identity with no team would be visible to nobody.
  if (draft.visibility === "team" && draft.teamIds.length === 0) return false;
  // The schema refuses duplicate keys; refuse at the button instead of after a round trip.
  const keys = cleanFields(draft.fields).map((f) => f.key);
  if (new Set(keys).size !== keys.length) return false;
  return true;
}

/** POST body: empty optionals are omitted; `teamIds` only with `team` (the schema refuses it otherwise). */
export function draftToCreateBody(draft: IdentityDraft): AgentIdentityCreateBody {
  const body: AgentIdentityCreateBody = {
    name: draft.name.trim(),
    visibility: draft.visibility,
  };
  const description = draft.description.trim();
  if (description) body.description = description;
  const instructions = draft.instructions.trim();
  if (instructions) body.instructions = instructions;
  if (draft.model) body.model = draft.model;
  if (draft.runtime) body.runtime = draft.runtime;
  const fields = cleanFields(draft.fields);
  if (fields.length > 0) body.fields = fields;
  if (draft.visibility === "team" && draft.teamIds.length > 0) {
    body.teamIds = [...draft.teamIds];
  }
  // `knowledge`, never `knowledgeBaseIds` (the schema refuses both in one request).
  if (draft.knowledge.length > 0) {
    body.knowledge = draft.knowledge.map(refToScope);
  }
  return body;
}

/**
 * PATCH body — the changed keys only (agents write identities too; a full body would revert them).
 * Clearing travels as `null`; `teamIds` only alongside `team`.
 */
export function draftToPatchBody(
  draft: IdentityDraft,
  original: AgentIdentity
): AgentIdentityUpdateBody {
  const before = draftFromIdentity(original);
  const patch: AgentIdentityUpdateBody = {};

  const name = draft.name.trim();
  if (name !== before.name) patch.name = name;
  const description = draft.description.trim();
  if (description !== before.description) patch.description = description || null;
  const instructions = draft.instructions.trim();
  if (instructions !== before.instructions) patch.instructions = instructions || null;
  if (draft.model !== before.model) patch.model = draft.model || null;
  if (draft.runtime !== before.runtime) patch.runtime = draft.runtime || null;

  const fields = cleanFields(draft.fields);
  if (!sameFields(fields, cleanFields(before.fields))) patch.fields = fields;

  const scopeChanged = draft.visibility !== before.visibility;
  if (scopeChanged) patch.visibility = draft.visibility;
  if (draft.visibility === "team" && (scopeChanged || !sameIds(draft.teamIds, before.teamIds))) {
    patch.teamIds = [...draft.teamIds];
  }

  const scopes = draft.knowledge.map(refToScope);
  if (!sameScopes(scopes, before.knowledge.map(refToScope))) {
    patch.knowledge = scopes;
  }
  return patch;
}

/** Nothing changed: the schema would refuse the empty patch, so Save closes instead. */
export function isEmptyPatch(patch: AgentIdentityUpdateBody): boolean {
  return Object.keys(patch).length === 0;
}

/** Order-sensitive (the operator arranged the rows), and the type is part of the row. */
function sameFields(
  a: ReadonlyArray<IdentityField>,
  b: ReadonlyArray<IdentityField>
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (f, i) => f.key === b[i].key && f.value === b[i].value && f.type === b[i].type
  );
}

/** Order-insensitive: pick order is not a fact. */
function sameIds(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((id) => set.has(id));
}

/** The optimistic row a PATCH produces; knowledge keeps the picker's own labels. */
export function optimisticIdentity(
  original: AgentIdentity,
  draft: IdentityDraft
): AgentIdentity {
  return {
    ...original,
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    instructions: draft.instructions.trim() || null,
    model: draft.model || null,
    runtime: draft.runtime || null,
    fields: cleanFields(draft.fields),
    visibility: draft.visibility,
    teamIds: draft.visibility === "team" ? [...draft.teamIds] : [],
    knowledge: [...draft.knowledge],
    // The base-level slice, as the server derives it — a folder scope never claims its base.
    knowledgeBases: draft.knowledge
      .filter((ref) => ref.scope === "base")
      .map((ref) => ({ id: ref.baseId, name: ref.baseName })),
  };
}
