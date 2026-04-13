"use client";

/**
 * MarkdownMessage — renders AI chat content as markdown with the exact
 * typography spec ported from openclaw-cloud's chat page.
 *
 * No bubble wrapper: text reads as if it's directly on the page,
 * not inside a speech balloon. Use for assistant/AI messages.
 */

import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

export function MarkdownMessage({ content, className }: MarkdownMessageProps) {
  return (
    <div
      className={cn(
        // Base prose scaffolding + base text color
        "prose prose-base max-w-none text-white/[0.88]",
        // Paragraphs: no top margin, tight bottom margin, 26px line-height
        "prose-p:my-0 prose-p:mb-3 prose-p:leading-[26px]",
        // Headings: unified style, small, semibold/bold, tight top margins
        "prose-headings:font-semibold prose-headings:text-white/90",
        "prose-h1:text-[13px] prose-h2:text-[13px] prose-h3:text-[13px]",
        "prose-h4:text-[13px] prose-h5:text-[13px] prose-h6:text-[13px]",
        "prose-h1:font-bold prose-h2:font-bold",
        "prose-h3:font-semibold prose-h4:font-semibold",
        "prose-h5:font-semibold prose-h6:font-semibold",
        "prose-h1:mt-3 prose-h2:mt-3 prose-h3:mt-2",
        // Bold text
        "prose-strong:text-white/90 prose-strong:font-semibold",
        // Inline code
        "prose-code:text-sm prose-code:bg-white/[0.08]",
        "prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded",
        // Code blocks
        "prose-pre:bg-white/[0.06] prose-pre:rounded-lg",
        // Lists
        "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
        className
      )}
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
