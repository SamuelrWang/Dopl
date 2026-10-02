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
export declare const TEXT_VALUE_MAX = 4000;
export declare const PILL_VALUE_MAX = 400;
export declare const ENUM_OPTION_MAX = 200;
export declare const ENUM_OPTIONS_MAX = 50;
export declare const LINK_VALUE_MAX = 2000;
export declare const FIELD_DESCRIPTION_MAX = 1000;
export declare function isStringKind(kind: FieldKind): kind is StringKind;
export declare function isIsoDate(value: string): boolean;
export declare function isHttpUrl(value: string): boolean;
/** Trimmed, non-empty, first-spelling-wins (case-insensitive). */
export declare function cleanOptions(options: readonly string[]): string[];
/** Caps the server would 400 on, named. `null` = fine. */
export declare function optionsProblem(options: readonly string[]): string | null;
/** A field description: trimmed, `""` clears. `undefined` = keep the stored one. */
export declare function nextDescription(given: string | undefined, stored: string | undefined): {
    description?: string;
} | {
    fail: ToolResponse;
};
/**
 * The template field a card's attribute was born from: same label on a
 * container that holds the card. A select field's options are the TEMPLATE's
 * when one exists (the panel reads them the same way).
 */
export declare function templateFieldFor(snapshot: OntologySnapshot, object: OntologyObject, label: string): OntologyTemplateField | undefined;
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
