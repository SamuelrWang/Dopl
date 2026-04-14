import { FileText, Download, Globe } from "lucide-react";

interface QuickActionsProps {
  onReadPage: () => void;
  onIngestPage: () => void;
  readingPage?: boolean;
  pageRead?: boolean;
}

export function QuickActions({ onReadPage, onIngestPage, readingPage, pageRead }: QuickActionsProps) {
  return (
    <div className="flex gap-2 px-3 py-2 border-b border-[var(--border-subtle)]">
      <button
        onClick={onReadPage}
        disabled={readingPage}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md
          bg-[var(--bg-elevated)] border border-[var(--border-default)]
          hover:bg-[var(--bg-elevated-hover)] hover:border-[var(--border-strong)]
          text-[var(--text-secondary)] transition-all disabled:opacity-50"
      >
        <FileText size={12} />
        {readingPage ? "Reading..." : pageRead ? "Re-read Page" : "Read Page"}
      </button>
      <button
        onClick={onIngestPage}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md
          bg-[var(--accent-soft)] border border-[var(--accent-primary)]/20
          hover:bg-[var(--accent-primary)]/20
          text-[var(--accent-primary)] transition-all"
      >
        <Download size={12} />
        Ingest Page
      </button>
    </div>
  );
}
