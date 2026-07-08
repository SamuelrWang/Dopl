/**
 * Route-level loading boundary. Mirrors the members console's two-pane
 * .page-float chrome (list pane + detail pane) so the swap to the live
 * page doesn't reflow.
 */
export default function Loading() {
  return (
    <div className="page-float flex antialiased">
      <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
        <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
          <span className="h-4 w-24 animate-pulse rounded bg-surface-raised-2" />
        </div>
        <div className="mx-3.5 mb-3 h-9 animate-pulse rounded-[9px] bg-bg-inset" />
        <div className="mx-3.5 mb-3 h-[35px] animate-pulse rounded-[10px] bg-bg-inset" />
        <div className="flex-1 border-t border-border-default">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3.5 py-2">
              <span className="h-6 w-6 animate-pulse rounded-full bg-surface-raised-2" />
              <span className="flex-1">
                <span className="block h-3 w-2/3 animate-pulse rounded bg-surface-raised-2" />
                <span className="mt-1.5 block h-2.5 w-1/2 animate-pulse rounded bg-surface-raised-1" />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-[52px] shrink-0 border-b border-border-default" />
        <div className="flex-1 px-14 pt-8">
          <div className="mx-auto max-w-[760px]">
            <div className="h-20 animate-pulse rounded-[14px] border border-border-default bg-surface-raised-1" />
            <div className="mt-4 h-36 animate-pulse rounded-[14px] border border-border-default bg-surface-raised-1" />
          </div>
        </div>
      </div>
    </div>
  );
}
