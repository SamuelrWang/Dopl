import { Fragment, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

export interface BreadcrumbItem {
  key: string;
  label: ReactNode;
  /** A leading mark: a chevron for "back", or a small identity face. */
  icon?: ReactNode;
  /** Makes the crumb a button. The last crumb is the current page and never takes one. */
  onSelect?: () => void;
  ariaLabel?: string;
}

/** THE breadcrumb (DESIGN-LANGUAGE §4): muted crumbs, `›` between, the current one in ink. */
export function Breadcrumb({
  items,
  className,
}: {
  items: readonly BreadcrumbItem[];
  /** The type step, for a trail that heads a pane rather than sitting above a box. */
  className?: string;
}) {
  const last = items.length - 1;
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex min-w-0 items-center gap-1.5 text-caption text-text-muted", className)}
    >
      {items.map((item, i) => (
        <Fragment key={item.key}>
          {i > 0 && <span aria-hidden="true">›</span>}
          {i === last ? (
            <span
              aria-current="page"
              className="inline-flex min-w-0 items-center gap-1 font-medium text-text-primary"
            >
              {item.icon}
              <span className="min-w-0 truncate">{item.label}</span>
            </span>
          ) : item.onSelect ? (
            <button
              type="button"
              aria-label={item.ariaLabel}
              onClick={item.onSelect}
              className="inline-flex flex-none items-center gap-0.5 text-text-muted transition-colors hover:text-text-primary"
            >
              {item.icon}
              {item.label}
            </button>
          ) : (
            <span className="inline-flex flex-none items-center gap-0.5">
              {item.icon}
              {item.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
