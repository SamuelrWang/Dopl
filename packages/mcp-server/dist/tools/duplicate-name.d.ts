/**
 * The duplicate-name warning for the three create lanes: it warns, never refuses, and runs after the create without ever failing it (F-701).
 * Containers are named by id, never looked up: a locked session must not learn other containers exist.
 */
/** The smallest shape all three row types satisfy. */
export interface NamedRow {
    id: string;
    name: string;
    workspaceId: string;
}
/**
 * The warning line, or `""`; case-insensitive, as the name resolvers are.
 * @param sameContainer true for identities (no per-container name uniqueness, so same-container clashes count); bases leave it false (slug is unique per container).
 */
export declare function duplicateNameNote(created: NamedRow, all: readonly NamedRow[], noun: string, canDescribe: boolean, sameContainer?: boolean): string;
/** {@link duplicateNameNote} over a list call that may throw or not exist; any failure is `""`. */
export declare function duplicateNameNoteFor(created: NamedRow, list: () => Promise<readonly NamedRow[]>, noun: string, canDescribe: boolean, sameContainer?: boolean): Promise<string>;
