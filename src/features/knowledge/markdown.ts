/**
 * Pure markdown serialization for knowledge entries. Outside `server/` so the
 * archive builder and any client-side download share one definition of what an
 * entry looks like as a `.md` file.
 *
 * The `body` is already markdown and the `title` is stored separately, so it is
 * prepended as an H1 — unless the body already opens with that exact heading.
 */

export function entryToMarkdown(entry: { title: string; body: string }): string {
  const title = entry.title.trim() || "Untitled";
  const body = (entry.body ?? "").replace(/\s+$/, "");
  const firstLine = body.split("\n", 1)[0]?.trim();
  if (firstLine === `# ${title}`) return `${body}\n`;
  if (!body) return `# ${title}\n`;
  return `# ${title}\n\n${body}\n`;
}
