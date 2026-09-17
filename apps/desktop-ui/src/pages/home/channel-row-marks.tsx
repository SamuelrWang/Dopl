/**
 * /home's CARD FACE and the channel row's two UNREAD MARKS — **re-exported from
 * `@/shared/ui/home-card-marks`, which is where they are declared since
 * 2026-09-17.**
 *
 * ⚠ **THE MOVE IS ABOUT A SECOND TREE, NOT ABOUT THIS PAGE.** The landing page's
 * hero demo renders /home's own chrome
 * (`src/features/marketing/components/banner-demo/`) and the Next tree cannot
 * import `apps/` at all — the root `tsconfig.json` excludes it and these files
 * resolve `#/*` against the SPA's own src. apps → root `src/` is the direction
 * that works (this page already takes it for `@/shared/**` and for eleven feature
 * components), so the ONE declaration moved there and this module is the path
 * every /home reader already imports. **No face, ink or mark changed.**
 *
 * ⚠ **DO NOT RE-DECLARE ANY OF THESE HERE.** The whole point of the shared
 * module is that a restyle lands on both hosts at once; a local copy is the
 * defect `shared/ui/page-action-button.ts` was extracted to fix.
 */

export {
  HOME_CARD_FACE,
  HOME_CARD_FACE_SELECTED,
  MentionBadge,
  UnreadDot,
  rowQuietInk,
} from "@/shared/ui/home-card-marks";
