/**
 * `dopl_ontology` op="history" and op="restore". History is PER FIELD — one
 * row per changed field, the app Changelog's granularity — for one object (`object=`) or an
 * ontology's roll-up (`ontology=`). Restore targets one OBJECT.
 *
 * ⚠ RESTORING A REVISION WRITES ITS `before` BACK — it undoes that change for that one field, and
 * the other fields keep their current values. Every row prints `before → after`, so the preview
 * is the row itself. Link, create and delete rows are listed and refused on restore (the server's
 * `REVISION_NOT_RESTORABLE`).
 * ⚠ `restore` REQUIRES `expected_version` and checks it here and atomically in the route.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opHistory(client: DoplClient, callerUserId: string | null, args: {
    object?: string;
    ontology?: string;
}): Promise<ToolResponse>;
export declare function opRestore(client: DoplClient, args: {
    object: string;
    revision: string;
    expected_version: string;
}): Promise<ToolResponse>;
