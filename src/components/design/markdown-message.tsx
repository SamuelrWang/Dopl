"use client";

/**
 * MarkdownMessage — renders AI chat content as markdown with the exact
 * typography spec ported from openclaw-cloud's chat page.
 *
 * No bubble wrapper: text reads as if it's directly on the page,
 * not inside a speech balloon. Use for assistant/AI messages.
 *
 * Supports citation markers: [cite:ENTRY_ID] are rendered as small
 * inline pills showing the entry name when an `entryNames` map is provided.
 */

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface MarkdownMessageProps {
  content: string;
  className?: string;
  /** Map of entry ID → display name for rendering citation pills */
  entryNames?: Record<string, string>;
}

const CITE_REGEX = /\[cite:([a-f0-9-]+)\]/gi;

/**
 * Replace [cite:UUID] markers with placeholder tokens that survive
 * markdown parsing, then swap them for React elements after render.
 */
function processCitations(
  content: string,
  entryNames: Record<string, string>
): React.ReactNode {
  // Split on citation markers
  const parts = content.split(CITE_REGEX);
  if (parts.length === 1) {
    // No citations
    return <ReactMarkdown>{content}</ReactMarkdown>;
  }

  // Rebuild: even indices are text, odd indices are entry IDs
  const segments: Array<{ type: "text"; value: string } | { type: "cite"; entryId: string }> = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) segments.push({ type: "text", value: parts[i] });
    } else {
      segments.push({ type: "cite", entryId: parts[i] });
    }
  }

  // Merge consecutive text segments and render
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "cite") {
          const name = entryNames[seg.entryId] || "Source";
          return (
            <span
              key={i}
              className="inline-flex items-center h-[18px] max-w-[100px] px-1.5 mx-0.5 text-[9px] font-mono uppercase tracking-wide text-purple-300/80 bg-purple-500/10 border border-purple-500/20 rounded-full align-middle cursor-default overflow-hidden text-ellipsis whitespace-nowrap"
              title={seg.entryId}
            >
              {name}
            </span>
          );
        }
        return <ReactMarkdown key={i}>{seg.value}</ReactMarkdown>;
      })}
    </>
  );
}

export function MarkdownMessage({ content, className, entryNames }: MarkdownMessageProps) {
  const rendered = useMemo(() => {
    if (entryNames && CITE_REGEX.test(content)) {
      // Reset lastIndex since we used the `g` flag
      CITE_REGEX.lastIndex = 0;
      return processCitations(content, entryNames);
    }
    return <ReactMarkdown>{content}</ReactMarkdown>;
  }, [content, entryNames]);

  return (
    <div
      className={cn(
        // Base prose scaffolding + base text color
        "prose prose-sm max-w-none text-white/[0.88]",
        // Paragraphs: no top margin, tight bottom margin
        "prose-p:my-0 prose-p:mb-2 prose-p:leading-[20px] prose-p:text-xs",
        // Headings: unified style, small, semibold/bold, tight top margins
        "prose-headings:font-semibold prose-headings:text-white/90",
        "prose-h1:text-xs prose-h2:text-xs prose-h3:text-xs",
        "prose-h4:text-xs prose-h5:text-xs prose-h6:text-xs",
        "prose-h1:font-bold prose-h2:font-bold",
        "prose-h3:font-semibold prose-h4:font-semibold",
        "prose-h5:font-semibold prose-h6:font-semibold",
        "prose-h1:mt-3 prose-h2:mt-3 prose-h3:mt-2",
        // Bold text
        "prose-strong:text-white/90 prose-strong:font-semibold",
        // Italic / emphasis — Tailwind Typography's default is
        // text-gray-500 which is unreadable on our dark surface.
        "prose-em:text-white/80 prose-em:italic",
        // Blockquotes — same readability issue. Keep the italic quote
        // feel but lift the text color, soften the left border to match
        // the rest of the dark chrome.
        "prose-blockquote:text-white/75 prose-blockquote:italic",
        "prose-blockquote:border-l-2 prose-blockquote:border-l-white/20",
        "prose-blockquote:pl-3 prose-blockquote:my-2",
        "prose-blockquote:font-normal",
        // Links — make them visible on the dark surface without
        // over-saturating. Default prose link color is too muted.
        "prose-a:text-sky-300/90 prose-a:underline prose-a:decoration-sky-300/30",
        "hover:prose-a:decoration-sky-300/80",
        // Inline code
        "prose-code:text-xs prose-code:bg-white/[0.08]",
        "prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded",
        // Code blocks
        "prose-pre:bg-white/[0.06] prose-pre:rounded-lg",
        // Lists
        "prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-li:text-xs prose-li:leading-[20px]",
        className
      )}
    >
      {rendered}
    </div>
  );
}
