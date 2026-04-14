/**
 * PageReaderView — Display extracted page content with action buttons.
 */

import { usePageContent } from "../hooks/usePageContent";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { FileText, Download, MessageSquare, ArrowLeft, Globe, Loader2, AlertCircle } from "lucide-react";

interface PageReaderViewProps {
  onIngest?: (url: string, text: string) => void;
  onSendToChat?: (text: string) => void;
  onBack?: () => void;
}

const contentTypeLabels: Record<string, string> = {
  article: "Article",
  tweet: "Tweet/Post",
  github: "GitHub",
  reddit: "Reddit",
  generic: "Web Page",
};

export function PageReaderView({ onIngest, onSendToChat, onBack }: PageReaderViewProps) {
  const { page, loading, error, extract, clear } = usePageContent();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-default)]">
        {onBack && (
          <button onClick={onBack} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            <ArrowLeft size={14} />
          </button>
        )}
        <FileText size={14} className="text-[var(--accent-primary)]" />
        <span className="text-xs font-medium text-[var(--text-primary)]">Page Reader</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Extract button */}
        {!page && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Globe size={32} className="text-[var(--text-disabled)] mb-3" />
            <p className="text-xs text-[var(--text-muted)] mb-3">
              Extract content from the current page
            </p>
            <button
              onClick={extract}
              className="px-4 py-2 rounded-lg text-xs font-medium
                bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20
                hover:bg-[var(--accent-primary)]/30 transition-all"
            >
              Read Current Page
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-[var(--accent-primary)]" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/20">
            <AlertCircle size={14} className="text-[var(--coral)] shrink-0" />
            <p className="text-xs text-[var(--coral)]">{error}</p>
          </div>
        )}

        {/* Extracted content */}
        {page && (
          <>
            {/* Metadata */}
            <div className="glass-card p-3 space-y-1.5">
              <h3 className="text-sm font-medium text-[var(--text-primary)]">{page.title}</h3>
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                <span className="mono-label">{contentTypeLabels[page.contentType] || page.contentType}</span>
                <span>{page.wordCount.toLocaleString()} words</span>
                {page.siteName && <span>{page.siteName}</span>}
                {page.byline && <span>by {page.byline}</span>}
              </div>
              <p className="text-xs text-[var(--text-secondary)]">{page.excerpt}</p>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {onIngest && (
                <button
                  onClick={() => onIngest(page.url, page.content)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium
                    bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20
                    hover:bg-[var(--accent-primary)]/30 transition-all"
                >
                  <Download size={12} />
                  Ingest
                </button>
              )}
              {onSendToChat && (
                <button
                  onClick={() => onSendToChat(page.content)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium
                    bg-[var(--bg-elevated)] border border-[var(--border-default)]
                    hover:bg-[var(--bg-elevated-hover)] text-[var(--text-secondary)] transition-all"
                >
                  <MessageSquare size={12} />
                  Add to Chat
                </button>
              )}
            </div>

            {/* Content preview */}
            <div className="glass-card p-3">
              <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
                Extracted Content
              </p>
              <div className="text-xs text-[var(--text-secondary)] max-h-[400px] overflow-y-auto whitespace-pre-wrap">
                {page.content.slice(0, 5000)}
                {page.content.length > 5000 && (
                  <span className="text-[var(--text-muted)]">
                    ... ({(page.content.length - 5000).toLocaleString()} more characters)
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
