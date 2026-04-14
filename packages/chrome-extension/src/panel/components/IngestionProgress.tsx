import { clsx } from "clsx";
import { Loader2, Check, AlertCircle } from "lucide-react";

interface ProgressEvent {
  type: string;
  message: string;
  step?: string;
  timestamp?: string;
}

interface IngestionProgressProps {
  events: ProgressEvent[];
  status: "streaming" | "complete" | "error";
}

const stepIcons: Record<string, { icon: string; color: string }> = {
  started: { icon: ">>", color: "text-[var(--accent-primary)]" },
  extract_complete: { icon: "OK", color: "text-[var(--mint)]" },
  readme_complete: { icon: "OK", color: "text-[var(--mint)]" },
  agents_md_complete: { icon: "OK", color: "text-[var(--mint)]" },
  manifest_complete: { icon: "OK", color: "text-[var(--mint)]" },
  tags_complete: { icon: "OK", color: "text-[var(--mint)]" },
  embedding_complete: { icon: "OK", color: "text-[var(--mint)]" },
  complete: { icon: "**", color: "text-[var(--mint)] font-bold" },
  error: { icon: "!!", color: "text-[var(--coral)] font-bold" },
};

export function IngestionProgress({ events, status }: IngestionProgressProps) {
  return (
    <div className="glass-card p-3 space-y-1">
      <div className="flex items-center gap-2 mb-2">
        {status === "streaming" && <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />}
        {status === "complete" && <Check size={14} className="text-[var(--mint)]" />}
        {status === "error" && <AlertCircle size={14} className="text-[var(--coral)]" />}
        <span className="text-xs font-medium text-[var(--text-primary)]">
          {status === "streaming" ? "Ingesting..." : status === "complete" ? "Complete" : "Error"}
        </span>
      </div>

      <div className="font-mono text-[10px] leading-relaxed space-y-0.5 max-h-[200px] overflow-y-auto">
        {events.map((event, i) => {
          const config = stepIcons[event.type] || { icon: "->", color: "text-[var(--text-muted)]" };
          return (
            <div key={i} className={clsx("flex gap-2", config.color)}>
              <span className="shrink-0 w-[16px] text-center">{config.icon}</span>
              <span className="break-all">{event.message}</span>
            </div>
          );
        })}
        {status === "streaming" && (
          <div className="flex gap-2 text-[var(--text-muted)] animate-pulse">
            <span className="shrink-0 w-[16px] text-center">..</span>
            <span>working...</span>
          </div>
        )}
      </div>
    </div>
  );
}
