/**
 * The banner demo's TIMELINE — ordered beats, replayed on a loop. Pure data;
 * the clock is use-demo-timeline.ts and the scene is banner-demo.tsx.
 *
 * Every visual is a function of the current step INDEX, so the whole scene is
 * one integer and reset is `index = 0`.
 */

export type StepId =
  | "channel-base"
  | "channel-samuel"
  | "thread-card"
  | "cursor-to-thread"
  | "click-thread"
  | "thread-open"
  | "launch-1"
  | "launch-2"
  | "launch-3"
  | "agent-msg-1"
  | "agent-msg-2"
  | "agent-msg-3"
  | "agent-msg-4"
  | "agent-msg-5"
  | "cursor-to-tab"
  | "click-tab"
  | "tab-open"
  | "cursor-to-agent"
  | "click-agent"
  | "agent-open"
  | "dm-user-1"
  | "dm-agent-1"
  | "dm-user-2"
  | "dm-agent-2"
  | "hold"
  | "reset-fade";

/** Ordered beats; `dur` = ms the timeline sits on that step before advancing. */
export const STEPS: ReadonlyArray<{ id: StepId; dur: number }> = [
  { id: "channel-base", dur: 1500 },
  { id: "channel-samuel", dur: 1600 },
  { id: "thread-card", dur: 1200 },
  { id: "cursor-to-thread", dur: 1300 },
  { id: "click-thread", dur: 550 },
  { id: "thread-open", dur: 1500 },
  { id: "launch-1", dur: 1100 },
  { id: "launch-2", dur: 1100 },
  { id: "launch-3", dur: 1200 },
  { id: "agent-msg-1", dur: 2000 },
  { id: "agent-msg-2", dur: 2100 },
  { id: "agent-msg-3", dur: 2100 },
  { id: "agent-msg-4", dur: 1900 },
  { id: "agent-msg-5", dur: 2000 },
  { id: "cursor-to-tab", dur: 1200 },
  { id: "click-tab", dur: 550 },
  { id: "tab-open", dur: 1300 },
  { id: "cursor-to-agent", dur: 1200 },
  { id: "click-agent", dur: 550 },
  { id: "agent-open", dur: 1500 },
  { id: "dm-user-1", dur: 1700 },
  { id: "dm-agent-1", dur: 2300 },
  { id: "dm-user-2", dur: 1700 },
  { id: "dm-agent-2", dur: 2400 },
  { id: "hold", dur: 2800 },
  { id: "reset-fade", dur: 450 },
];

const INDEX: Record<StepId, number> = Object.fromEntries(
  STEPS.map((s, i) => [s.id, i]),
) as Record<StepId, number>;

export const stepIndex = (id: StepId): number => INDEX[id];
/** True once the timeline has reached (or passed) `id`. */
export const reached = (step: number, id: StepId): boolean => step >= INDEX[id];
/** True only while the timeline sits ON `id`. */
export const at = (step: number, id: StepId): boolean => step === INDEX[id];

/**
 * The design canvas.
 *
 * ⚠ ONLY THE WIDTH IS FIXED (2026-08-30). The component scales the canvas to
 * FILL the slot — `scale = slotWidth / CANVAS_W` — and derives the height from
 * that scale, so the scene reaches both edges instead of being letterboxed
 * inside them (banner-demo.tsx › `fit`, which carries the gutters this
 * replaced). CANVAS_W is mirrored by `marketing.css › .lp-demo-canvas`; keep
 * the two in step.
 *
 * CANVAS_H is now only the SEED for the derived height — what the box measures
 * before the slot has one (first paint, a hidden tab). It is the old fixed
 * height and any plausible number would do; nothing lays out against it.
 */
export const CANVAS_W = 1480;
export const CANVAS_H = 800;
