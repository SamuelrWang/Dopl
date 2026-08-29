import type {
  AgentTemplate,
  AgentTemplateCreateBody,
  AgentTemplateUpdateBody,
  TemplateField,
  TemplateVisibility,
} from "../client/types";

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
  knowledgeBaseIds: string[];
}

export function emptyDraft(): TemplateDraft {
  return {
    name: "",
    description: "",
    instructions: "",
    model: "",
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBaseIds: [],
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
    knowledgeBaseIds: template.knowledgeBases.map((kb) => kb.id),
  };
}

/**
 * THE COPY — one home-workspace template, as a draft for a NEW row in a link
 * CONTAINER ("Use in this channel", `docs/specs/home-agents-tab.plan.md` §3 and
 * Samuel's ruling Q2, 2026-08-26).
 *
 * ⚠ WHY A COPY AT ALL, since a "share across workspaces" flag sounds simpler: a
 * scope-C template CANNOT LAUNCH INTO A CONTAINER. `getTemplateById` is
 * workspace-filtered and `/resolve` passes the LAUNCH workspace, so the id 404s —
 * a same-workspace trigger, not a permission anyone lacks, and no grant table
 * could fix it (INVARIANTS §5A). This is CLIENT-COMPOSED over the EXISTING POST:
 * no new route, no new service, no server change.
 *
 * 🔒 **THE ATTACHED KNOWLEDGE BASES ARE DROPPED, NOT CARRIED.** A home-workspace
 * KB id is not in the container, and the attach gate ("a KB the CALLER can
 * currently read", §5A) would 404 it — so carrying the ids turns a copy into a
 * failed write. ⚠ **AND THERE IS NO NAME-MATCH RE-ATTACH.** Resolving "Fundraise
 * memos" here against a same-named base in the container would be a SECOND,
 * WEAKER ATTACH GATE — one that resolves by string where the server resolves by
 * id and readability — and the first time two bases share a name it attaches the
 * wrong one silently. The drop is stated to the operator in the confirm step.
 *
 * ⚠ **IT IS A SNAPSHOT THAT DIVERGES.** No FK, no back-pointer, no sync: the two
 * rows are strangers the moment this returns, and editing the original does not
 * reach the copy. That is the same culture as `channel_sessions.template_name` —
 * A DENORMALIZED SNAPSHOT, NOT AN FK, AND NOTHING MAY "FIX" THAT LATER. A future
 * `copiedFrom` column would make the container row point at a workspace its
 * members cannot read.
 *
 * ⚠ **`visibility` IS FORCED TO `private`, NEVER CARRIED.** A home template that
 * happened to be `workspace`-visible would otherwise land SHARED WITH THE PEER on
 * a gesture whose whole word is "use" — publishing into a shared container is a
 * decision the operator makes afterwards, in the editor, deliberately.
 *
 * ⚠ **THE NAME IS CARRIED UNCHANGED — NO "(copy)" SUFFIX.** Templates have NO
 * name uniqueness, deliberately (there is no unique index and no 409 on the
 * route), so a suffix would be dodging a constraint that does not exist and
 * renaming the operator's agent to do it.
 */
export function containerCopyDraft(template: AgentTemplate): TemplateDraft {
  return {
    ...draftFromTemplate(template),
    // 🔒 ⚠ `workspace`, AND IT WAS `private` UNTIL 2026-08-27. The old value was
    // right under the old pane: "use" must not publish the operator's agent into
    // the room the peer is standing in, so the copy landed in the container's
    // PRIVATE section. **That section is gone** (Samuel's ruling — the /home
    // Agents face converged on Knowledge's two-section shape), and a container
    // is not navigable, so a `private` container row is now reachable from
    // NOWHERE: the copy would succeed, the dialog would close, and nothing would
    // appear anywhere. A write-only row is worse than a stated audience change.
    // ⚠ THE AUDIENCE CHANGE IS REAL AND IS SAID OUT LOUD — `agent-copy.tsx`'s
    // confirm text names the peer before the operator presses. Do not quietly
    // put this back to `private`; the fix for "I did not want to share it" is
    // not to make it invisible.
    visibility: "workspace",
    teamIds: [],
    knowledgeBaseIds: [],
  };
}

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
  if (draft.knowledgeBaseIds.length > 0) {
    body.knowledgeBaseIds = [...draft.knowledgeBaseIds];
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

  if (!sameIds(draft.knowledgeBaseIds, before.knowledgeBaseIds)) {
    patch.knowledgeBaseIds = [...draft.knowledgeBaseIds];
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
 * ⚠ KNOWLEDGE BASES ARE PATCHED FROM THE PICKER'S OWN LABELS, which is why this
 * takes a name lookup: the wire sends ids and answers with `{id, name}` pairs,
 * and a chip that went blank for one frame would read as "detached".
 */
export function optimisticTemplate(
  original: AgentTemplate,
  draft: TemplateDraft,
  knowledgeBaseName: (id: string) => string | undefined
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
    knowledgeBases: draft.knowledgeBaseIds.map((id) => ({
      id,
      name:
        knowledgeBaseName(id) ??
        original.knowledgeBases.find((kb) => kb.id === id)?.name ??
        id,
    })),
  };
}
