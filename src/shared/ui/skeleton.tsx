import { cn } from "@/shared/lib/utils";

/** Shimmer atom (kit). Every loading skeleton composes this — never re-hardcode pulse/surface recipe locally. */
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

/** Sized shimmer bar. px numbers or CSS sizes; radius via className. */
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

/** One-text-line ghost — rounded-full pill. */
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

/** Tapering paragraph ghost — N lines, decreasing widths. */
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

/** List-row ghost — optional leading avatar/icon over two stacked lines. */
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
 * Message-transcript ghost — alternating bubble column (chats archive +
 * channels thread). Bubble geometry must match the loaded list (agent flat on
 * elevated, user indented on subtle card) or the swap to real messages reflows.
 */
export function TranscriptSkeleton({
  bubbles = 4,
  className,
}: {
  bubbles?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {Array.from({ length: bubbles }).map((_, i) => {
        const fromUser = i % 2 === 1;
        return (
          <div
            key={i}
            className={cn(
              "rounded-[10px] border px-3.5 py-2.5",
              fromUser
                ? "ml-12 border-border-default bg-card-surface-subtle"
                : "border-border-subtle bg-bg-elevated"
            )}
          >
            <SkeletonLine w={68} h={8} className="mb-2" />
            <SkeletonText lines={fromUser ? 1 : 2} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Two-pane list + detail loading shell — knowledge / chats / skills / members /
 * channels. `detail` swaps the right pane (channels passes `TranscriptSkeleton`).
 * `label` is the screen-reader announcement: the visual is `aria-hidden`
 * shimmer, so it is the ONLY thing a reader gets.
 */
export function TwoPaneListSkeleton({
  listWidth = 372,
  rows = 7,
  leading = "none",
  label = "Loading",
  detail,
}: {
  listWidth?: number;
  rows?: number;
  leading?: "circle" | "square" | "none";
  label?: string;
  detail?: React.ReactNode;
}) {
  return (
    <div
      className="page-float flex antialiased"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>

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
              leading={leading}
              className="border-b border-border-subtle"
            />
          ))}
        </div>
      </div>

      {detail ?? <DetailDocSkeleton />}
    </div>
  );
}

/** Detail-pane chrome + slot — the shared 52px top bar over a caller-supplied body. */
export function DetailPaneSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border-default px-4">
        <SkeletonLine w={176} h={13} />
        <span className="flex-1" />
        <Skeleton className="h-7 w-7 rounded-md" />
      </div>
      {children}
    </div>
  );
}

/** Right-pane document ghost. Mirrors the loaded detail pane, not the empty state. */
export function DetailDocSkeleton() {
  return (
    <DetailPaneSkeleton>
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
    </DetailPaneSkeleton>
  );
}

/**
 * Single-surface page ghost — for pages that are NOT two-pane lists (overview,
 * settings, ontology, canvas). Desktop shell holds this through its whole boot
 * chain so five sequential pending states read as ONE surface, not five flickers.
 */
export function PageShellSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="page-float flex flex-col antialiased"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>

      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border-default px-4">
        <SkeletonLine w={132} h={14} />
        <span className="flex-1" />
        <Skeleton className="h-7 w-7 rounded-md" />
        <Skeleton className="h-7 w-7 rounded-md" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 pt-6">
        <div className="mx-auto max-w-[960px] space-y-4">
          <Skeleton className="h-[76px] w-full rounded-[14px]" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-[104px] rounded-[14px]" />
            <Skeleton className="h-[104px] rounded-[14px]" />
            <Skeleton className="h-[104px] rounded-[14px]" />
          </div>
          <div className="overflow-hidden rounded-[14px] border border-border-strong">
            <div className="flex items-center gap-2 border-b border-border-default bg-card-surface-subtle px-4 py-2.5">
              <SkeletonLine w={92} h={9} />
            </div>
            <div className="space-y-4 px-5 py-5">
              <SkeletonLine w="46%" h={12} />
              <SkeletonText lines={2} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
