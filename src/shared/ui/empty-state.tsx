import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * THE empty-detail treatment for two-pane browsers (chats / members / skills).
 * Bare hint line stays muted; a title over a description gets the emphasis.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2.5 px-10 text-text-muted">
      <Icon size={30} className="text-border-strong" />
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
