/**
 * THE TEXT LINK — plain text that takes the ink underline, close under the letters, on hover and
 * on keyboard focus (the Tasks tab's title, the knowledge tree's New file, the tasks quick view's
 * See all). No face, no fill, no height; type and layout stay with the caller.
 *
 * Not the TAB UNDERLINE (`segmented-control.tsx › SegmentedControl variant="underline"`), whose
 * rule sits further below the label and marks the selected tab only.
 */
export const TEXT_LINK_BUTTON =
  "decoration-text-primary underline-offset-2 hover:underline focus-visible:underline";
