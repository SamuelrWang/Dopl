import type {
  AgentTemplate,
  AgentTemplateCreateBody,
  AgentTemplateUpdateBody,
  TemplateField,
  TemplateKnowledgeRef,
  TemplateVisibility,
} from "../client/types";
import {
  EMPTY_KNOWLEDGE,
  refToScope,
  sameScopes,
} from "./knowledge-scopes";

/**
 * THE EDITOR'S FORM STATE, and the two bodies it becomes.
 *
 * ⚠ PURE — no React, no transport. The editor holds one `TemplateDraft` in
 * state and this module answers every question about it, so the payload shape is
 * testable without rendering a modal and cannot be re-derived differently by a
 * second call site (INVARIANTS §1: one file, one reason to change).
 *
 * ⚠ THE DRAFT IS ALL-STRINGS BY DESIGN. A `<textarea>` hands back `""`, never
 * `null`, so the draft mirrors the CONTROL and the mapping to "absent" or
 * "cleared" happens once, here, at the boundary.
 *
 * ⚠ CLEARING SENDS `null`, NOT `""` — the schema's own rule (`../schema.ts`:
 * "`null` and ABSENT differ and both are meaningful: absent leaves the column
 * alone, `null` CLEARS it"). It is not a style choice for `model`: that field is
 * a `safeLabel`, which carries a `.min(1)`, so an emptied model sent as `""`
 * would be a 400 on the operator picking Default.
 */

export interface TemplateDraft {
  name: string;
  description: string;
  instructions: string;
  /** `""` = Default (`channels/lib/agent-models.ts › AGENT_MODEL_DEFAULT`). */
  model: string;
  fields: TemplateField[];
  visibility: TemplateVisibility;
  /**
   * ⚠ PLURAL, because the server's is (`../types.ts › AgentTemplate.teamIds`,
   * `../schema.ts › TeamIdsSchema`). A single-team draft would have to pick one
   * on read and silently drop the rest on the next save.
   */
  teamIds: string[];
  /**
   * THE ATTACHED SCOPES, AS RESOLVED REFS (2026-09-08) — **replacing
   * `knowledgeBaseIds`, which this draft no longer has.**
   *
   * ⚠ **REFS AND NOT SCOPES, because a chip needs a LABEL.** The wire carries
   * ids (`refToScope` is the conversion, applied at the two body builders); the
   * draft carries the name and the path beside them so the editor can render
   * `Base / Folder / Entry` without a second read. The picker composes the path
   * from the tree it already loaded for that base; the server's own `path` wins
   * on the next read, exactly as the base NAME already did.
   * ⚠ IT IS A SET, ORDER-INSENSITIVE — see `sameScopes`.
   */
  knowledge: TemplateKnowledgeRef[];
}

/**
 * A BRAND-NEW TEMPLATE'S DRAFT.
 *
 * 🔒 **IT OPENS WITH ONE BLANK FIELD ROW (Samuel, 2026-09-22: a new template
 * *"should have an existing blank field that is already in, just have it
 * blank"*).** The row is a DRAFT fact and lives here rather than in
 * `CustomFieldRows`, which renders both a create and an EDIT: a starter row
 * painted by the component would also appear over a saved template whose fields
 * were all removed, where an empty row reads as a field somebody deleted.
 *
 * ⚠ **IT COSTS NOTHING IF IT IS NEVER TYPED IN.** `cleanFields` drops a row with
 * a blank key at both body builders, so an untouched starter row is not in the
 * POST — the create still writes `fields: []`, byte for byte what it wrote
 * before this ruling.
 */
export function emptyDraft(): TemplateDraft {
  return {
    name: "",
    description: "",
    instructions: "",
    model: "",
    fields: [{ key: "", value: "" }],
    visibility: "private",
    teamIds: [],
    knowledge: [],
  };
}

export function draftFromTemplate(template: AgentTemplate): TemplateDraft {
  return {
    name: template.name,
    description: template.description ?? "",
    instructions: template.instructions ?? "",
    model: template.model ?? "",
    fields: template.fields.map((f) => ({ key: f.key, value: f.value })),
    visibility: template.visibility,
    teamIds: [...template.teamIds],
    // 🔒 §8 STALE-CACHE FALLBACK, SPELLED INLINE. A row cached by the bundle
    // before scopes shipped has no `knowledge` key at all, and mapping over
    // `undefined` throws and blanks the editor — the exact failure §8 was
    // written for. `EMPTY_KNOWLEDGE` is the honest reading of "not sent".
    knowledge: [...(template.knowledge ?? EMPTY_KNOWLEDGE)],
  };
}

/**
 * ⚠ **`containerCopyDraft` STOOD HERE UNTIL 2026-09-02 (wave B slice B15,
 * Samuel's ruling B11: *grants replace copies*).** It composed the "Use in this
 * channel" copy: `draftFromTemplate` with `visibility` forced to `workspace` and
 * both id sets cleared, because a home-workspace KB id meant nothing in the
 * container and carrying it turned a copy into a failed write.
 *
 * **Nothing replaced it in this module.** The control is a GRANT now
 * (`apps/desktop-ui/src/pages/home/agent-share.tsx`), which writes a
 * `resource_grants` row and composes no draft at all — there is no second
 * template to build.
 *
 * ⚠ **THE REST OF THIS FILE IS THE SHARED EDITOR DRAFT AND IS UNTOUCHED.** The
 * wave-B spec's B15 row counted this file whole as copy code (F-600); 250 of its
 * lines are `TemplateDraft` and its eight helpers, imported by
 * `components/template-editor.tsx`, `apps/desktop-ui/src/pages/home/agent-editor.tsx`
 * and `components/agent-templates-core.tsx`.
 */

/**
 * Custom fields worth sending: a row whose KEY is blank carries nothing, and the
 * editor's add-row starts blank — so an operator who clicked "Add field" and
 * changed their mind must not get an empty pair written to their template.
 * A blank VALUE is kept: the schema allows it ("a key with no value yet is a
 * legitimate half-filled form"), and it is a thing an operator can mean.
 */
export function cleanFields(fields: ReadonlyArray<TemplateField>): TemplateField[] {
  return fields
    .map((f) => ({ key: f.key.trim(), value: f.value.trim() }))
    .filter((f) => f.key !== "");
}

/** Save is refused on a nameless template; everything else is optional. */
export function isDraftSavable(draft: TemplateDraft): boolean {
  if (draft.name.trim() === "") return false;
  // A Team template with no team named would be visible to nobody, which is a
  // private template wearing the wrong label. Fail closed at the button.
  if (draft.visibility === "team" && draft.teamIds.length === 0) return false;
  // The schema refuses a duplicate key with a 400; the button is a cheaper place
  // to say so than the alert line after a round trip.
  const keys = cleanFields(draft.fields).map((f) => f.key);
  if (new Set(keys).size !== keys.length) return false;
  return true;
}

/**
 * POST body.
 *
 * ⚠ AN EMPTY OPTIONAL IS OMITTED on a create — "never written" and "written,
 * then emptied" are the same state on a row that does not exist yet, and
 * `model: ""` is the Default sentinel this tree deliberately does not have
 * (absence IS Default).
 *
 * ⚠ `teamIds` RIDES ONLY THE TEAM SCOPE, and the schema REFUSES it otherwise
 * ("teamIds requires visibility 'team'") rather than ignoring it — so sending it
 * on a private template is a 400, not a harmless extra key.
 */
export function draftToCreateBody(draft: TemplateDraft): AgentTemplateCreateBody {
  const body: AgentTemplateCreateBody = {
    name: draft.name.trim(),
    visibility: draft.visibility,
  };
  const description = draft.description.trim();
  if (description) body.description = description;
  const instructions = draft.instructions.trim();
  if (instructions) body.instructions = instructions;
  if (draft.model) body.model = draft.model;
  const fields = cleanFields(draft.fields);
  if (fields.length > 0) body.fields = fields;
  if (draft.visibility === "team" && draft.teamIds.length > 0) {
    body.teamIds = [...draft.teamIds];
  }
  // ⚠ `knowledge`, NEVER `knowledgeBaseIds`: the schema refuses both in one
  // request, and this client can express a folder scope that the older key
  // cannot. The older key stays on the SCHEMA for older clients, not for this
  // one.
  if (draft.knowledge.length > 0) {
    body.knowledge = draft.knowledge.map(refToScope);
  }
  return body;
}

/**
 * PATCH body — the CHANGED keys only, compared against the row on screen.
 *
 * ⚠ PARTIAL IS THE POINT, and the diff is why. This editor is not the only
 * writer of a template (`PATCH` is reachable by an agent token too), so PATCHing
 * every field back would silently revert whatever moved under an open modal.
 *
 * ⚠ THE CREATE BODY'S OMIT-WHEN-EMPTY RULE INVERTS HERE: clearing a description
 * is a real edit, and it travels as `null`.
 *
 * ⚠ `teamIds` IS SENT ONLY ALONGSIDE `visibility: "team"`. Leaving the team
 * scope sends the visibility alone — the server drops the grants with it, and a
 * `teamIds` key on a non-team patch is refused by the schema.
 */
export function draftToPatchBody(
  draft: TemplateDraft,
  original: AgentTemplate
): AgentTemplateUpdateBody {
  const before = draftFromTemplate(original);
  const patch: AgentTemplateUpdateBody = {};

  const name = draft.name.trim();
  if (name !== before.name) patch.name = name;
  const description = draft.description.trim();
  if (description !== before.description) patch.description = description || null;
  const instructions = draft.instructions.trim();
  if (instructions !== before.instructions) patch.instructions = instructions || null;
  if (draft.model !== before.model) patch.model = draft.model || null;

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

/** Nothing to send = nothing was edited; the editor closes instead of writing.
 *  ⚠ The schema refuses an empty patch outright ("Patch must change at least one
 *  field"), so this is the check that keeps a no-op Save off the wire. */
export function isEmptyPatch(patch: AgentTemplateUpdateBody): boolean {
  return Object.keys(patch).length === 0;
}

/** ⚠ ORDER-SENSITIVE: rows are a list an operator arranged, not a set. */
function sameFields(
  a: ReadonlyArray<TemplateField>,
  b: ReadonlyArray<TemplateField>
): boolean {
  if (a.length !== b.length) return false;
  return a.every((f, i) => f.key === b[i].key && f.value === b[i].value);
}

/** ⚠ ORDER-INSENSITIVE: the pick order of a multi-select is not a fact. */
function sameIds(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((id) => set.has(id));
}

/**
 * The optimistic row a PATCH produces, so the card behind the modal updates on
 * the click rather than on the round trip.
 *
 * ⚠ KNOWLEDGE IS PATCHED FROM THE PICKER'S OWN LABELS, which is why the draft
 * carries REFS: the wire sends ids and answers with names and paths, and a chip
 * that went blank for one frame would read as "detached".
 * ⚠ **THE `knowledgeBaseName` LOOKUP PARAMETER LEFT ON 2026-09-08** and both
 * call sites dropped the `useMemo` that built it. It existed because the draft
 * held BARE IDS and the name had to be recovered from the picker's options; a
 * ref carries its own name, so the lookup was a third place a label could
 * disagree with the two that already had it.
 */
export function optimisticTemplate(
  original: AgentTemplate,
  draft: TemplateDraft
): AgentTemplate {
  return {
    ...original,
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    instructions: draft.instructions.trim() || null,
    model: draft.model || null,
    fields: cleanFields(draft.fields),
    visibility: draft.visibility,
    teamIds: draft.visibility === "team" ? [...draft.teamIds] : [],
    knowledge: [...draft.knowledge],
    // ⚠ THE BASE-LEVEL SLICE, derived from the same list the server derives it
    // from — a folder scope contributes nothing here, because listing its base
    // would claim the whole base is attached.
    knowledgeBases: draft.knowledge
      .filter((ref) => ref.scope === "base")
      .map((ref) => ({ id: ref.baseId, name: ref.baseName })),
  };
}
