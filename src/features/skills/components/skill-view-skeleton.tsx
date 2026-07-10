/**
 * Skeleton mirroring `SkillView`'s chrome (file-tabs strip + main
 * editor column inside a framed panel). Rendered by the route-level
 * `loading.tsx` so click → page-paint feels instant while the server
 * resolves auth, workspace, skill, and KB list.
 */
import { SkeletonBar } from "@/shared/ui/skeleton";

export function SkillViewSkeleton() {
  return (
    <div
      className="h-full"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading skill</span>
      <div className="h-full overflow-hidden flex">
        {/* Main column — file tabs + editor */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="shrink-0 flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <SkeletonBar h={24} w={112} className="rounded-md" />
            <SkeletonBar h={24} w={96} className="rounded-md" />
            <SkeletonBar h={24} w={80} className="rounded-md" />
            <SkeletonBar h={24} w={24} className="ml-auto rounded-md" />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="max-w-3xl mx-auto px-8 py-10 space-y-5">
              <SkeletonBar h={24} w="50%" />
              <div className="space-y-2.5">
                <SkeletonBar h={12} w="100%" />
                <SkeletonBar h={12} w="92%" />
                <SkeletonBar h={12} w="85%" />
                <SkeletonBar h={12} w="75%" />
              </div>
              <div className="space-y-2.5 pt-3">
                <SkeletonBar h={16} w="33.333%" />
                <SkeletonBar h={12} w="100%" />
                <SkeletonBar h={12} w="88%" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
