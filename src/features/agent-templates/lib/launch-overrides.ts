import type { AgentTemplate, TemplateField } from "../client/types";

/**
 * WHAT AN OPERATOR MAY CHANGE AT LAUNCH — the shape, the bounds, and the
 * "did anything actually change?" question. Nothing here renders and nothing
 * here reaches the bridge (INVARIANTS §1: one file, one reason to change).
 *
 * ⚠ OVERRIDES ARE EPHEMERAL AND THIS MODULE IS WHY THAT IS CHEAP. Nothing
 * written here is ever PATCHed back onto the template: the launch sheet builds
 * one of these, `sessions.launch` carries it, main splices it into that one
 * spawn's ROLE block, and the durable row is untouched. The template's own
 * editor is the only authoring surface (`../components/template-editor.tsx`).
 *
 * ⚠ MODEL **AND** FIELDS, both (Samuel, 2026-08-22 — this RESOLVES the spec's
 * OQ-2, which recommended model-only for the first wave). The product statement
 * is that a launch may re-point both, so shipping model-only would have meant a
 * second form and a second wave for the half already designed.
 *
 * ⚠ THE CHARSET RULE IS NOT RE-STATED HERE, DELIBERATELY, AND THE BOUNDS BELOW
 * ARE ONLY THE NUMBERS. `SAFE_LABEL_RE` lives in `@/shared/lib/safe-label`,
 * whose module body imports **zod** — and `../client/types.ts` is explicit that
 * a value import from that family "would drag the validator into the renderer",
 * which is a rule about the desktop SPA bundle rather than a style preference.
 * A second copy of a neutralizer is worse than none (the copy that drifts is the
 * one that stops neutralizing), so the client half is: **single-line `<input>`
 * elements, which cannot hold a newline by construction, plus the size caps
 * below** — and MAIN RE-VALIDATES the whole payload before any of it reaches a
 * prompt. Filed as F-281.
 *
 * The four numbers mirror `../schema.ts` exactly (`TemplateFieldSchema`,
 * `MAX_FIELDS_BYTES`, `MAX_FIELD_COUNT`) so an override cannot be shaped in a
 * way the durable row could never have held.
 */

export const MAX_OVERRIDE_KEY_CHARS = 80;
export const MAX_OVERRIDE_VALUE_CHARS = 1000;
export const MAX_OVERRIDE_FIELD_COUNT = 50;
export const MAX_OVERRIDE_FIELDS_BYTES = 8192;

/**
 * The ephemeral half of a launch.
 *
 * ⚠ ABSENT IS THE ONLY SPELLING OF "NO OVERRIDE". There is no `null` sentinel
 * and no empty-object-means-default: `undefined` on either key means main reads
 * the template's own value, which is the same rule
 * `channels/lib/agent-models.ts › AGENT_MODEL_DEFAULT` follows for the durable
 * posture row — one vocabulary, three surfaces.
 */
export interface TemplateLaunchOverrides {
  /** An SDK model id. Absent ⇒ the template's `model`, or the desktop's own
   *  default when the template carries none. */
  model?: string;
  /** REPLACES the template's `fields` for this spawn — never merged. A partial
   *  merge over a set the operator can edit is how two field lists silently
   *  diverge (`../schema.ts`'s replace-set rule, same argument). */
  fields?: TemplateField[];
}

/** UTF-8 bytes, measured the way `../schema.ts` and the DB CHECK measure. */
function serializedBytes(fields: ReadonlyArray<TemplateField>): number {
  return new TextEncoder().encode(JSON.stringify(fields)).length;
}

/**
 * Bring a sheet's working rows inside the bounds a template row could hold.
 *
 * ⚠ A ROW WITH AN EMPTY KEY IS DROPPED, NOT REJECTED — the same answer
 * `../lib/template-draft.ts › cleanFields` gives the editor, so a half-typed row
 * does not block a launch. An empty VALUE is kept: a key with no value is a
 * legitimate half-filled form and the schema allows it.
 *
 * ⚠ OVERFLOW DROPS FROM THE END rather than truncating a value. A silently
 * clipped field value is a lie about what the agent was handed; a missing field
 * is at least visibly missing.
 */
export function boundOverrideFields(
  fields: ReadonlyArray<TemplateField>
): TemplateField[] {
  const cleaned: TemplateField[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    const key = field.key.trim().slice(0, MAX_OVERRIDE_KEY_CHARS);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ key, value: field.value.trim().slice(0, MAX_OVERRIDE_VALUE_CHARS) });
    if (cleaned.length >= MAX_OVERRIDE_FIELD_COUNT) break;
  }
  while (cleaned.length > 0 && serializedBytes(cleaned) > MAX_OVERRIDE_FIELDS_BYTES) {
    cleaned.pop();
  }
  return cleaned;
}

function sameFields(
  a: ReadonlyArray<TemplateField>,
  b: ReadonlyArray<TemplateField>
): boolean {
  return (
    a.length === b.length &&
    a.every((field, i) => field.key === b[i]?.key && field.value === b[i]?.value)
  );
}

/**
 * WHAT THE SHEET ACTUALLY CHANGED, or `undefined` when it changed nothing.
 *
 * ⚠ AN UNTOUCHED SHEET LAUNCHES BYTE-IDENTICALLY TO A ROW CLICK, and that is the
 * property this function exists for. Opening the sheet and pressing Launch must
 * not put a payload on the wire that clicking the row would not have — otherwise
 * two paths the operator reads as "launch this template" reach main as two
 * different requests, and only one of them is covered by the row-click test.
 */
export function overridesFor(
  template: AgentTemplate,
  model: string,
  fields: ReadonlyArray<TemplateField>
): TemplateLaunchOverrides | undefined {
  const overrides: TemplateLaunchOverrides = {};
  const trimmedModel = model.trim();
  // `""` IS "template default" on this surface, never "the SDK default" — the
  // sheet's first option says so in words. A pick equal to what the template
  // already carries is not an override either.
  if (trimmedModel && trimmedModel !== (template.model ?? "")) {
    overrides.model = trimmedModel;
  }
  const bounded = boundOverrideFields(fields);
  if (!sameFields(bounded, template.fields)) overrides.fields = bounded;
  return overrides.model === undefined && overrides.fields === undefined
    ? undefined
    : overrides;
}
