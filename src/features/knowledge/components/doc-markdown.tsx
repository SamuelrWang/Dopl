"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/shared/lib/utils";

interface Props {
  content: string;
  className?: string;
}

/**
 * Document-style markdown renderer for knowledge-base entries. Uses
 * remark-gfm so tables, strikethrough, and task lists work. Typography
 * is sized for reading-as-a-doc (Google Docs / Notion vibe), distinct
 * from the chat-message scale used in `MarkdownMessage`.
 */
export function DocMarkdown({ content, className }: Props) {
  return (
    <div
      className={cn(
        // Base — documentation-style: 14px body, comfortable but compact
        "prose max-w-none text-text-primary/90",
        // Paragraphs — uniform sizing across the doc, no surprises
        "prose-p:my-3 prose-p:leading-[1.65] prose-p:text-[14px]",
        // Headings — modest hierarchy, more like Mintlify / Stripe docs
        "prose-headings:text-text-primary prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-h1:text-[18px] prose-h1:mt-7 prose-h1:mb-2",
        "prose-h2:text-[15px] prose-h2:mt-6 prose-h2:mb-1.5",
        "prose-h3:text-[14px] prose-h3:mt-5 prose-h3:mb-1",
        "prose-h4:text-[13px] prose-h4:mt-4 prose-h4:mb-1",
        // Bold + italic
        "prose-strong:text-text-primary prose-strong:font-semibold",
        "prose-em:text-text-primary/85 prose-em:italic",
        // Blockquote — soft callout look, no italic / quote marks
        "prose-blockquote:not-italic prose-blockquote:font-normal",
        "prose-blockquote:text-text-primary/85 prose-blockquote:border-l-2 prose-blockquote:border-l-violet-400/40",
        "prose-blockquote:pl-3.5 prose-blockquote:my-3 prose-blockquote:py-0.5",
        "[&_blockquote_p]:my-1 [&_blockquote_p]:text-[14px] [&_blockquote_p:before]:hidden [&_blockquote_p:after]:hidden",
        // Lists — same size as body
        "prose-ul:my-2.5 prose-ol:my-2.5 prose-li:my-0.5 prose-li:text-[14px] prose-li:leading-[1.65]",
        "prose-ul:pl-5 prose-ol:pl-5",
        "[&_li::marker]:text-text-secondary/50",
        // Inline code
        "prose-code:text-[12.5px] prose-code:bg-white/[0.06] prose-code:border prose-code:border-white/[0.06]",
        "prose-code:px-1 prose-code:py-px prose-code:rounded prose-code:font-mono",
        "prose-code:before:content-none prose-code:after:content-none",
        // Code blocks
        "prose-pre:bg-white/[0.04] prose-pre:border prose-pre:border-white/[0.06]",
        "prose-pre:rounded-lg prose-pre:my-3 prose-pre:text-[12.5px]",
        // Links
        "prose-a:text-violet-300 prose-a:no-underline hover:prose-a:underline",
        // Horizontal rule
        "prose-hr:border-white/[0.08] prose-hr:my-6",
        // Tables — clean docs look
        "[&_table]:my-3 [&_table]:border-collapse [&_table]:w-full [&_table]:text-[13px]",
        "[&_thead]:bg-white/[0.03]",
        "[&_th]:text-left [&_th]:font-semibold [&_th]:text-text-primary [&_th]:px-3 [&_th]:py-1.5",
        "[&_th]:border [&_th]:border-white/[0.08]",
        "[&_td]:px-3 [&_td]:py-1.5 [&_td]:border [&_td]:border-white/[0.06] [&_td]:text-text-primary/90",
        "[&_tbody_tr:hover]:bg-white/[0.02]",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
