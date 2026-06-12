"use client";

import { cn } from "@/shared/lib/utils";
import { RevealGate } from "../reveal";

interface PillCascadeProps {
  title: string;
  pills: string[];
  /** Pills hug the right edge (default) or the left. */
  align?: "right" | "left";
  className?: string;
}

/**
 * Dark rounded card with a staggered cascade of pills sliding in —
 * each row indented a step further than the last.
 */
export function PillCascade({
  title,
  pills,
  align = "right",
  className,
}: PillCascadeProps) {
  const fromX = align === "right" ? "48px" : "-48px";

  return (
    <RevealGate className={className}>
      {(started) => (
        <div className="relative overflow-hidden rounded-3xl bg-[#12161f] p-7 shadow-[0_24px_60px_-24px_rgba(14,34,64,0.55)] ring-1 ring-white/10">
          <p className="font-semibold text-white/95">{title}</p>
          <div
            className={cn(
              "mt-6 flex flex-col gap-2.5",
              align === "right" ? "items-end" : "items-start",
            )}
          >
            {pills.map((pill, i) => (
              <div
                key={pill}
                className={cn(
                  "rounded-full border border-[#4a9eff]/45 bg-[#4a9eff]/10 px-4 py-2 text-sm font-medium text-[#bcd9ff]",
                  started && "mk-pill",
                )}
                style={
                  {
                    opacity: started ? undefined : 0,
                    "--mk-delay": `${i * 90}ms`,
                    "--mk-pill-from": fromX,
                    [align === "right" ? "marginRight" : "marginLeft"]:
                      `${i * 14}px`,
                  } as React.CSSProperties
                }
              >
                {pill}
              </div>
            ))}
          </div>
          <div
            className="pointer-events-none absolute -bottom-20 -right-20 size-56 rounded-full opacity-30 blur-3xl"
            style={{ background: "#3d7bff" }}
          />
        </div>
      )}
    </RevealGate>
  );
}
