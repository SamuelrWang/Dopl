/**
 * Canonical parser for skill bodies.
 *
 * Bodies are vanilla markdown with two Dopl-flavored extensions
 * encoded as standard markdown links:
 *
 *   [label](dopl://kb/<slug>)                       → KB chip
 *   [label](dopl://connector/<provider>)            → connector chip
 *   [label](dopl://connector/<provider>.<field>)    → connector chip
 *                                                     (with sub-field)
 *
 * `## Heading` lines on their own paragraph become section blocks.
 *
 * The parser is consumed by both the React renderer (chips) and the
 * server-side MCP resolver (extracted references). Pure and runs in
 * either environment — no `server-only` / `client-only` directive.
 */

export interface KbRef {
  kind: "kb";
  slug: string;
  label: string;
}

export interface ConnectorRef {
  kind: "connector";
  provider: string;
  field?: string;
  label: string;
}

export type SkillRef = KbRef | ConnectorRef;

export interface ParagraphBlock {
  kind: "paragraph";
  inlines: Inline[];
}

export interface SectionBlock {
  kind: "section";
  heading: string;
}

export type SkillBlock = ParagraphBlock | SectionBlock;

export interface TextInline {
  kind: "text";
  text: string;
}

export type Inline = TextInline | (SkillRef & { kind: "kb" | "connector" });

export interface ParsedSkillBody {
  blocks: SkillBlock[];
  references: SkillRef[];
}

const KB_HREF = /^dopl:\/\/kb\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/i;
const CONNECTOR_HREF =
  /^dopl:\/\/connector\/([a-z0-9-]+)(?:\.([a-z0-9-]+))?$/i;

// Markdown-link tokenizer. Stops at the first ')' after the opening '('.
// Bracketed labels can't contain a literal `]` and links can't contain
// a literal `)` — matches the vanilla-markdown parsing the renderer
// would do anyway.
const LINK_TOKEN = /\[([^\]]+)\]\(([^)]+)\)/g;

const SECTION_LINE = /^##\s+(.+?)\s*$/;

export function parseSkillBody(markdown: string): ParsedSkillBody {
  const blocks: SkillBlock[] = [];
  const references: SkillRef[] = [];
  const seenRefs = new Set<string>();

  const paragraphs = markdown.split(/\n\n+/);
  for (const raw of paragraphs) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const sectionMatch = SECTION_LINE.exec(trimmed);
    if (sectionMatch && !trimmed.includes("\n")) {
      blocks.push({ kind: "section", heading: sectionMatch[1] });
      continue;
    }

    const inlines = tokenizeInlines(trimmed);
    for (const inline of inlines) {
      if (inline.kind !== "text") {
        const key = refKey(inline);
        if (!seenRefs.has(key)) {
          seenRefs.add(key);
          references.push(stripInline(inline));
        }
      }
    }
    blocks.push({ kind: "paragraph", inlines });
  }

  return { blocks, references };
}

function tokenizeInlines(text: string): Inline[] {
  const out: Inline[] = [];
  let cursor = 0;
  LINK_TOKEN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = LINK_TOKEN.exec(text)) !== null) {
    const [whole, label, href] = match;
    const ref = parseDoplHref(label, href);
    if (!ref) continue;

    if (match.index > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    out.push({ ...ref });
    cursor = match.index + whole.length;
  }

  if (cursor < text.length) {
    out.push({ kind: "text", text: text.slice(cursor) });
  }
  return out;
}

function parseDoplHref(label: string, href: string): SkillRef | null {
  const kbMatch = KB_HREF.exec(href);
  if (kbMatch) {
    return { kind: "kb", slug: kbMatch[1], label: label.trim() };
  }
  const connectorMatch = CONNECTOR_HREF.exec(href);
  if (connectorMatch) {
    return {
      kind: "connector",
      provider: connectorMatch[1].toLowerCase(),
      field: connectorMatch[2]?.toLowerCase(),
      label: label.trim(),
    };
  }
  return null;
}

function refKey(ref: SkillRef): string {
  if (ref.kind === "kb") return `kb:${ref.slug}`;
  return `connector:${ref.provider}${ref.field ? `.${ref.field}` : ""}`;
}

function stripInline(ref: SkillRef): SkillRef {
  if (ref.kind === "kb") {
    return { kind: "kb", slug: ref.slug, label: ref.label };
  }
  return {
    kind: "connector",
    provider: ref.provider,
    field: ref.field,
    label: ref.label,
  };
}
