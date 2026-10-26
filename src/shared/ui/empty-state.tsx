import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * THE empty treatment. `pane` (default) is the empty detail of a two-pane browser (chats /
 * members / skills): a bare hint line stays muted; a title over a description gets the emphasis.
 * `well` is an empty LIST inside a card: a small icon and one phrase in a `.card-well`, so the
 * empty state keeps a shape. `outline` is the same on a surface that takes no grey fill: a dashed
 * hairline box (the /home Overview cards).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  variant = "pane",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  variant?: "pane" | "well" | "outline";
  className?: string;
}) {
  if (variant !== "pane") {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-1.5 text-caption text-text-muted",
          variant === "well"
            ? "card-well min-h-13"
            : "min-h-10 rounded-[10px] border border-dashed border-border-default",
          className
        )}
      >
        {Icon && <Icon size={14} aria-hidden="true" />}
        <span>{title}</span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-2.5 px-10 text-text-muted",
        className
      )}
    >
      {Icon && <Icon size={30} className="text-border-strong" />}
      <p
        className={cn(
          "text-body",
          description && "font-medium text-text-secondary"
        )}
      >
        {title}
      </p>
      {description && (
        <p className="max-w-[380px] text-center text-caption leading-relaxed">
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

/** A section body with nothing in it: one muted, centred line. Render it only against a RESOLVED
 *  read, never while the list is still loading. */
export function EmptyLine({ children }: { children: string }) {
  return <p className="px-4 py-6 text-center text-caption text-text-muted">{children}</p>;
}
