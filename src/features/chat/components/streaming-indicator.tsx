"use client";

/**
 * Three-dot animated "Generating..." indicator. Used as a tail marker
 * while the AI turn is still streaming. The label is configurable so
 * we can show "Searching..." / "Generating context file..." etc.
 */
export function StreamingIndicator({ label = "Generating" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-text-secondary">
      <span className="flex items-end gap-0.5">
        <span className="w-1 h-1 rounded-full bg-violet-300/80 animate-pulse" />
        <span
          className="w-1 h-1 rounded-full bg-violet-300/80 animate-pulse"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="w-1 h-1 rounded-full bg-violet-300/80 animate-pulse"
          style={{ animationDelay: "300ms" }}
        />
      </span>
      <span>{label}</span>
    </div>
  );
}
