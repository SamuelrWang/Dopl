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
export function duplicateNameNote(
  created: NamedRow,
  all: readonly NamedRow[],
  noun: string,
  canDescribe: boolean,
  sameContainer = false,
): string {
  const needle = created.name.trim().toLocaleLowerCase();
  if (needle === "") return "";
  const clashes = all.filter(
    (r) =>
      r.id !== created.id &&
      (sameContainer || r.workspaceId !== created.workspaceId) &&
      r.name.trim().toLocaleLowerCase() === needle,
  );
  if (clashes.length === 0) return "";
  const containers = [...new Set(clashes.map((c) => c.workspaceId))].sort();
  const where = containers.map((c) => `\`${c}\``).join(", ");
  const remedy = canDescribe
    ? `Rename one of them, or say in its \`description\` how the two differ.`
    : `Rename one of them.`;
  return (
    `\n\n⚠ DUPLICATE NAME: ${clashes.length} other ${noun}${clashes.length === 1 ? "" : "s"} you can see carry this name, in container${containers.length === 1 ? "" : "s"} ${where}. ` +
    `Addressing it by NAME is ambiguous from now on and will be refused. ${remedy} Addressing it by ID always works.`
  );
}

/** {@link duplicateNameNote} over a list call that may throw or not exist; any failure is `""`. */
export async function duplicateNameNoteFor(
  created: NamedRow,
  list: () => Promise<readonly NamedRow[]>,
  noun: string,
  canDescribe: boolean,
  sameContainer = false,
): Promise<string> {
  try {
    return duplicateNameNote(created, await list(), noun, canDescribe, sameContainer);
  } catch {
    return "";
  }
}
