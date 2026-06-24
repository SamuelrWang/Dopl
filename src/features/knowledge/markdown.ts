/**
 * Pure markdown serialization for knowledge entries.
 *
 * Lives outside `server/` so both the server-side archive builder
 * (`server/export.ts`) and any client-side single-file download path
 * share one definition of "what an entry looks like as a `.md` file".
 *
 * An entry's `body` is already markdown; the `title` is stored
 * separately, so we prepend it as an H1 to make the file self-
 * describing — unless the body already opens with that exact heading
 * (avoids a duplicated title on entries written title-first).
 */

export function entryToMarkdown(entry: { title: string; body: string }): string {
  const title = entry.title.trim() || "Untitled";
  const body = (entry.body ?? "").replace(/\s+$/, "");
  const firstLine = body.split("\n", 1)[0]?.trim();
  if (firstLine === `# ${title}`) return `${body}\n`;
  if (!body) return `# ${title}\n`;
  return `# ${title}\n\n${body}\n`;
}
