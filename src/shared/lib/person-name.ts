/** A person's first name, for a pill or a possessive; `fallback` when the name is blank. */
export function firstNameOf(name: string | null | undefined, fallback: string): string {
  return name?.trim().split(/\s+/)[0] || fallback;
}
