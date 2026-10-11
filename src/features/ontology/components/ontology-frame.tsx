import type { ReactNode } from "react";

/**
 * The two surfaces `ontology-view.tsx › OntologyView` can paint into, picked by its
 * `frameless` prop. Split out of the view for the 500-line cap; nothing else mounts them.
 */

/** Floats the surface as one raised card via the global .page-float. */
export function Float({ children }: { children?: ReactNode }) {
  return (
    <div className="page-float flex flex-col antialiased">{children}</div>
  );
}

/** Fills a host that is already the page panel — no second card. */
export function Fill({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col antialiased">
      {children}
    </div>
  );
}
