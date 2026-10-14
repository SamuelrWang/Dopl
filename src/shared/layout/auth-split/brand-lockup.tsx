import type { ReactNode } from "react";

/**
 * Mark + "Dopl" wordmark, side by side — the lockup the auth split pins to its
 * corner (`AuthSplitLayout` › cornerBrand). ONE component for the signed-out
 * screen and every onboarding step, so the two cannot drift and the lockup
 * reads as fixed while the pages change around it (Samuel 2026-10-13).
 *
 * `mark` is passed in, not imported: the packaged desktop renderer needs an
 * inlined image (see `AuthSplitLayout` › bannerSrc for the same problem).
 */
export function BrandLockup({ mark }: { mark: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      {mark}
      <span
        className="text-[21px] font-medium text-[#181818]"
        style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontStyle: "italic" }}
      >
        Dopl
      </span>
    </div>
  );
}
