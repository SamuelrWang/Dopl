/**
 * Tour feature constants — the resume key and the decoupled start signal.
 *
 * `TOUR_START_EVENT` is a plain window-event name (not an import) so the
 * onboarding welcome popup can trigger the tour without a sideways
 * feature import (ENGINEERING §3). The popup dispatches the event; the
 * TourProvider listens for it.
 */

/** localStorage key prefix that persists the current screen so a mid-tour reload resumes. */
export const TOUR_STEP_KEY = "dopl:tour-step";

/**
 * A tour walks ONE workspace, so its resume state is scoped per workspace
 * segment — a step saved in workspace A must never restore inside B.
 */
export function tourStepKey(workspaceSegment: string): string {
  return `${TOUR_STEP_KEY}:${workspaceSegment}`;
}

/** Window event the welcome popup dispatches to start the tour. */
export const TOUR_START_EVENT = "dopl:start-tour";
