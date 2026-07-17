import { cn } from "@/shared/lib/utils";

/**
 * Pulsing placeholder block — the token-tinted shimmer atom (kit). Every
 * page/table loading skeleton composes this (or the helpers below); no
 * component re-hardcodes the pulse/surface recipe locally.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded bg-surface-raised-2", className)}
      {...props}
    />
  );
}

/**
 * Sized shimmer bar — the loading atom the route/table skeletons compose
 * (px numbers or CSS sizes; pass `rounded-full` etc. via className).
 */
export function SkeletonBar({
  h,
  w,
  className,
}: {
  h: number | string;
  w: number | string;
  className?: string;
}) {
  return <Skeleton style={{ height: h, width: w }} className={className} />;
}

/**
 * Single line-of-copy ghost — a rounded-full pill sized to one text line.
 * Width defaults to full; height to a body line.
 */
export function SkeletonLine({
  w = "100%",
  h = 10,
  className,
}: {
  w?: number | string;
  h?: number | string;
  className?: string;
}) {
  return <SkeletonBar h={h} w={w} className={cn("rounded-full", className)} />;
}

/** Tapering paragraph ghost — N lines with decreasing widths. */
const PARAGRAPH_WIDTHS = ["100%", "94%", "88%", "80%", "72%", "64%"];

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} w={PARAGRAPH_WIDTHS[i % PARAGRAPH_WIDTHS.length]} />
      ))}
    </div>
  );
}

/**
 * List-row ghost — an optional leading avatar/icon block over two stacked
 * lines. The row shape the knowledge / chats / members list panes share.
 */
export function SkeletonRow({
  leading = "circle",
  className,
}: {
  leading?: "circle" | "square" | "none";
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2.5 px-3.5 py-2.5", className)}>
      {leading !== "none" && (
        <Skeleton
          className={cn(
            "h-6 w-6 shrink-0",
            leading === "circle" ? "rounded-full" : "rounded-md"
          )}
        />
      )}
      <div className="min-w-0 flex-1 space-y-2 py-0.5">
        <SkeletonLine w="66%" />
        <SkeletonLine w="42%" h={8} />
      </div>
    </div>
  );
}

/**
 * Two-pane list + detail loading skeleton inside the shared `.page-float`
 * shell — the shape knowledge / chats / skills / members all load into.
 * A list pane (header + search + segmented control + row ghosts) beside a
 * detail pane (top bar + centered document ghost), so arriving at a
 * two-pane page never flashes flat panels or empty space before the
 * elevated surface paints. Server-fetched pages render it from their
 * route-level `loading.tsx`.
 */
export function TwoPaneListSkeleton({
  listWidth = 372,
  rows = 7,
}: {
  listWidth?: number;
  rows?: number;
}) {
  return (
    <div
      className="page-float flex antialiased"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading</span>

      <div
        className="flex shrink-0 flex-col border-r border-border-default"
        style={{ width: listWidth }}
      >
        <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
          <SkeletonLine w={84} h={14} />
        </div>
        <Skeleton className="mx-3.5 mb-3 h-9 rounded-[9px]" />
        <Skeleton className="mx-3.5 mb-3 h-[35px] rounded-[10px]" />
        <div className="min-h-0 flex-1 border-t border-border-default">
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonRow
              key={i}
              leading="none"
              className="border-b border-border-subtle"
            />
          ))}
        </div>
      </div>

      <DetailDocSkeleton />
    </div>
  );
}

/**
 * Right-pane document ghost — top bar + a centered title, prose lines, and
 * a framed meta-card ghost. Mirrors the loaded detail pane's shape (the
 * knowledge/chats document, the skills editor) rather than the transient
 * empty state.
 */
function DetailDocSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border-default px-4">
        <SkeletonLine w={176} h={13} />
        <span className="flex-1" />
        <Skeleton className="h-7 w-7 rounded-md" />
      </div>
      <div className="flex-1 overflow-hidden px-14 pt-9">
        <div className="mx-auto max-w-[760px] space-y-6">
          <SkeletonBar h={26} w="52%" className="rounded-md" />
          <SkeletonText lines={3} />
          <div className="overflow-hidden rounded-[14px] border border-border-strong">
            <div className="flex items-center gap-2 border-b border-border-default bg-card-surface-subtle px-4 py-2.5">
              <SkeletonLine w={92} h={9} />
            </div>
            <div className="space-y-4 px-5 py-5">
              <SkeletonLine w="40%" h={12} />
              <SkeletonText lines={2} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
