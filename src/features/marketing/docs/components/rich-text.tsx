import Link from "next/link";
import type { ReactNode } from "react";

/** One token of inline marks: `code`, **bold** or [label](href). */
const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;

/**
 * Renders a docs `Rich` string. Three marks only, never HTML — content is data and a
 * stray `<` prints as text.
 */
export function RichText({ text }: { text: string }) {
  const parts = text.split(TOKEN).filter(Boolean);
  return <>{parts.map((part, i) => renderPart(part, i))}</>;
}

function renderPart(part: string, key: number): ReactNode {
  if (part.startsWith("`") && part.endsWith("`")) {
    return <code key={key}>{part.slice(1, -1)}</code>;
  }
  if (part.startsWith("**") && part.endsWith("**")) {
    return <strong key={key}>{part.slice(2, -2)}</strong>;
  }
  const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
  if (link) {
    const [, label, href] = link;
    if (href.startsWith("/")) {
      return (
        <Link key={key} href={href}>
          {label}
        </Link>
      );
    }
    return (
      <a key={key} href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
  }
  return part;
}
