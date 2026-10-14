import type { ReactNode } from "react";

import type { LegalBlock } from "./parse-legal-markdown";

/**
 * Renders `parse-legal-markdown.ts`'s blocks. Server component, no client JS.
 *
 * Inline marks: `**bold**`, `` `code` ``, and bare email addresses, which become
 * `mailto:` links — the TEXT is unchanged, only made clickable.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  return text.split(INLINE).flatMap((part, idx): ReactNode[] => {
    if (part === "") return [];
    const key = `${keyPrefix}-${idx}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return [<strong key={key}>{renderInline(part.slice(2, -2), key)}</strong>];
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return [<code key={key}>{part.slice(1, -1)}</code>];
    }
    if (part.includes("@") && /^[^\s@]+@[^\s@]+$/.test(part)) {
      return [
        <a key={key} href={`mailto:${part}`}>
          {part}
        </a>,
      ];
    }
    return [part];
  });
}

/** "(a) …", "(iv) …" — enumerated clauses, set as hanging items. */
const CLAUSE = /^\((?:[a-z]|[ivx]+)\)\s/;
/** A paragraph that is bold from end to end — the ALL-CAPS notices. */
const ALL_BOLD = /^\*\*[^*]+\*\*$/;

function LegalBlockView({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case "heading":
      return block.level === 2 ? (
        <h2 id={block.id}>{renderInline(block.text)}</h2>
      ) : (
        <h3 id={block.id}>{renderInline(block.text)}</h3>
      );
    case "rule":
      return <hr />;
    case "quote":
      return (
        <blockquote>
          {block.lines.map((line, i) => (
            <p key={i}>{renderInline(line, `q${i}`)}</p>
          ))}
        </blockquote>
      );
    case "table":
      return (
        // The wrapper scrolls, never the page (mobile: no horizontal page scroll).
        <div className="legal-table-wrap">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} scope="col">
                    {renderInline(cell, `h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{renderInline(cell, `c${r}-${c}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "paragraph": {
      const className = ALL_BOLD.test(block.text)
        ? "legal-notice"
        : CLAUSE.test(block.text)
          ? "legal-clause"
          : undefined;
      return <p className={className}>{renderInline(block.text)}</p>;
    }
  }
}

export function LegalMarkdown({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => (
        <LegalBlockView key={i} block={block} />
      ))}
    </>
  );
}
