import { cn } from "@/shared/lib/utils";

/** Pulsing placeholder block — token-tinted (kit). */
export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded bg-surface-raised-2", className)}
      {...props}
    />
  );
}

/**
 * Sized skeleton bar — the loading-state atom the route/table skeletons
 * compose (px numbers or CSS sizes; pass `rounded-full` etc. via
 * className).
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
  return (
    <Skeleton
      aria-hidden="true"
      style={{ height: h, width: w }}
      className={className}
    />
  );
}
