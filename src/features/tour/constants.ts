/**
 * Tour resume key + decoupled start signal. ⚠ `TOUR_START_EVENT` is a plain
 * window-event name, not an import, so the onboarding welcome popup triggers
 * the tour without a sideways feature import (ENGINEERING §3).
 */

/** localStorage key prefix — persists current screen so a reload resumes. */
export const TOUR_STEP_KEY = "dopl:tour-step";

/** ⚠ Resume state scoped per workspace segment: a step saved in workspace A
 *  must never restore inside B. */
export function tourStepKey(workspaceSegment: string): string {
  return `${TOUR_STEP_KEY}:${workspaceSegment}`;
}

/** Event the welcome popup dispatches to start the tour. */
export const TOUR_START_EVENT = "dopl:start-tour";
