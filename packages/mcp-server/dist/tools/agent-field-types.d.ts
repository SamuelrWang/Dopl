/**
 * `dopl_agent` custom-field TYPES (DMP-009, 2026-09-23): the product's five-word vocabulary and the
 * value check the editor's controls imply.
 *
 * ⚠ THE VALUE IS ALWAYS A STRING. `type` is the editor's input affordance (`identity-editor-rows.tsx ›
 * FieldValueInput`) and the server never validates a value against it, so the rules here are
 * exactly what that control can PRODUCE: a number box yields a decimal numeral, a date box
 * `YYYY-MM-DD`, the yes/no select `yes` / `no`; `url` stays free text there, so it is unchecked
 * here too. `""` is legal for every type (a half-filled form). An agent that sends a value the UI
 * could never have written would hand the editor a control it cannot render.
 *
 * ⚠ AN UNCHANGED FIELD ALWAYS ROUND-TRIPS: a stored row whose value predates its type is sent back
 * as-is without being checked, so a read-modify-write never loses a field it did not touch.
 */
import type { IdentityField } from "@dopl/client";
import { type ToolResponse } from "./respond.js";
/** Refusal naming the first field whose value its type cannot hold, else null. */
export declare function fieldTypeRefusal(fields: readonly IdentityField[] | undefined, stored?: readonly IdentityField[]): ToolResponse | null;
