/**
 * The banner demo's TIMELINE — ordered beats, replayed on a loop. Pure data;
 * the clock is use-demo-timeline.ts and the scene is banner-demo.tsx.
 *
 * Every visual is a function of the current step INDEX, so the whole scene is
 * one integer and reset is `index = 0`.
 */

/**
 * 🔒 **NO THREAD BEATS SINCE 2026-09-17 (Samuel):** *"Render THAT composition …
 * No thread view."* Four steps are deleted — `thread-card`, `cursor-to-thread`,
 * `click-thread`, `thread-open` — because opening a thread put the pane on the
 * WORKSPACE shape: a breadcrumb header and a thread-scoped info column, which is
 * what he was looking at when he rejected the scene. The opener they existed for
 * is now an ordinary channel message on `channel-request`.
 */
export type StepId =
  | "channel-base"
  | "channel-samuel"
  | "channel-request"
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
  { id: "channel-request", dur: 1800 },
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
/**
 * 🔒 **1280 — THE DESKTOP WINDOW'S OWN WIDTH (Samuel, 2026-09-17).** He put the
 * hero beside the live /home pane and the scene read as *"the denser workspace
 * scale"*: *"Product is the home 30px scale: larger type, taller rows, bigger
 * radii, more padding … the frame's fixed size may need the scene's viewport
 * widened/scaled rather than the components shrunk."*
 *
 * ⚠ **NOTHING WAS SHRUNK — THE DESIGN VIEWPORT WAS TOO WIDE.** Every control in
 * this scene is the product's own component at the product's own size; the
 * canvas is then scaled by `slotWidth / CANVAS_W`, so a WIDER canvas in the same
 * slot makes every one of those controls land SMALLER on the reader's screen.
 * At 1480 the scene was 1480/1280 = **1.16× denser** than the real window.
 * ⚠ **1280 IS MEASURED, NOT PICKED**:
 * `dopl-desktop-app/main/spa-window.js › createSpaWindow` opens the SPA at
 * `width: 1280`. Match it and the hero is the product at 1:1 in design units.
 * ⚠ CANVAS_W is mirrored by `marketing.css › .lp-demo-canvas`; keep the two in
 * step.
 */
export const CANVAS_W = 1280;
export const CANVAS_H = 820;
