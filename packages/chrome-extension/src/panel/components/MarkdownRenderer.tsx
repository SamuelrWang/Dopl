/**
 * Lightweight markdown renderer for chat messages.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose prose-invert prose-sm max-w-none
      prose-p:text-[var(--text-primary)] prose-p:text-sm prose-p:leading-relaxed prose-p:my-1
      prose-headings:text-[var(--text-primary)] prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1
      prose-a:text-[var(--accent-primary)] prose-a:no-underline hover:prose-a:underline
      prose-code:text-[var(--accent-primary)] prose-code:bg-[var(--bg-inset)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono
      prose-pre:bg-[var(--bg-inset)] prose-pre:border prose-pre:border-[var(--border-default)] prose-pre:rounded-lg prose-pre:text-xs
      prose-li:text-[var(--text-primary)] prose-li:text-sm
      prose-strong:text-[var(--text-primary)]
      prose-blockquote:border-[var(--accent-soft)] prose-blockquote:text-[var(--text-secondary)]"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
