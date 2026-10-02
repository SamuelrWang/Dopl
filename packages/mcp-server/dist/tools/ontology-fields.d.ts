/**
 * The ontology's FIELD rules on the MCP side — kinds, the one-string values'
 * checks, a field's description and a select's options (2026-10-01).
 *
 * ⚠ HAND-MIRRORED from `src/features/ontology/field-kinds.ts` + `schema.ts`
 * (this tree cannot import `src/`). The server is the fence — every write still
 * parses through `OntologyObjectUpdateSchema` — so this copy exists to fail at
 * the tool boundary with a field-named message instead of an opaque
 * downstream VALIDATION_FAILED. Change both together.
 */
import type { OntologyObject, OntologySnapshot, OntologyTemplateField } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare const FIELD_KINDS: readonly ["text", "pill", "enum", "date", "link", "ref", "knowledge", "skill"];
export type FieldKind = (typeof FIELD_KINDS)[number];
export type StringKind = "text" | "pill" | "enum" | "date" | "link";
export declare function isStringKind(kind: FieldKind): kind is StringKind;
/** Trimmed, non-empty, first-spelling-wins (case-insensitive). */
export declare function cleanOptions(options: readonly string[]): string[];
/** Caps the server would 400 on, named. `null` = fine. */
export declare function optionsProblem(options: readonly string[]): string | null;
/**
 * The template field a card's attribute was born from: same label (else same
 * `key`, the panel's address) on a container that holds the card. A select
 * field's options are the TEMPLATE's when one exists (the panel reads them the
 * same way), and its DESCRIPTION is the template's ONLY (2026-10-01) — a card
 * carries no copy, and a stray stored one is never read.
 */
export declare function templateFieldFor(snapshot: OntologySnapshot, object: OntologyObject, label: string, key?: string): OntologyTemplateField | undefined;
/**
 * `set_attribute` was sent a `description` — refused, naming the door that
 * takes it. One field, one description: it is the object TYPE's
 * (`set_template_field` on the container), shared by every card of the type.
 */
export declare function attributeDescriptionRefusal(snapshot: OntologySnapshot, object: OntologyObject, label: string): ToolResponse;
/**
 * One string value for `kind`, checked: the select's choice (matched
 * case-insensitively, stored as the option's own spelling), a day, a link.
 * `""` clears every kind.
 */
export declare function stringValue(kind: StringKind, raw: string, label: string, options: readonly string[]): {
    value: string;
} | {
    fail: ToolResponse;
};
export interface FieldArgs {
    label?: string;
    kind?: FieldKind;
    description?: string;
    options?: string[];
}
/**
 * `set_template_field` as a pure upsert by label. ⚠ An omitted `kind`,
 * `description` or `options` KEEPS the stored one — an agent adding a
 * description must not reset a select to text.
 */
export declare function upsertTemplateField(template: readonly OntologyTemplateField[], args: FieldArgs): {
    template: OntologyTemplateField[];
    field: OntologyTemplateField;
} | {
    fail: ToolResponse;
};
/** `(enum: `A`, `B`)` / `(date)` / `` — the kind note a field line carries.
 *  Text and tag say nothing, which is what every line said before kinds grew. */
export declare function kindNote(kind: FieldKind, options?: readonly string[]): string;
/** A link value inline: a code span with backticks percent-encoded, so `#`,
 *  `_` and `[` survive (the neutralizer would strip them out of the URL). */
export declare function linkSpan(url: string): string;
