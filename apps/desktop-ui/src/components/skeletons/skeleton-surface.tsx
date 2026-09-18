/**
 * ⚠ **A RE-EXPORT SINCE 2026-09-17 (wave 2).** `SkeletonSurface` / `SkeletonChrome`
 * live in `src/shared/ui/skeleton-surface.tsx` now, because the channel record
 * ghost moved into `src/features/channels/` and that tree cannot import `#/`
 * (INVARIANTS §1). This path survives so the SPA's nine skeletons did not all
 * have to move in the same commit.
 */
export { SkeletonSurface, SkeletonChrome } from "@/shared/ui/skeleton-surface";
