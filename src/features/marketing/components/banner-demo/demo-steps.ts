/**
 * The banner demo's TIMELINE — ordered beats, replayed on a loop. Pure data;
 * the clock is use-demo-timeline.ts and the scene is banner-demo.tsx.
 *
 * Every visual is a function of the current step INDEX, so the whole scene is
 * one integer and reset is `index = 0`.
 */

/**
 * **THREAD BEATS ARE BACK, AND THE 2026-09-17 OBJECTION TO THEM NO LONGER HOLDS**
 * (Samuel, 2026-10-12).
 *
 * ⚠ **WHAT THAT NOTE SAID, AND WHY IT WAS RIGHT AT THE TIME.** It read: *"No thread
 * beats: opening a thread put the pane on the WORKSPACE shape — a breadcrumb header
 * and a thread-scoped info column."* That is an accurate description of what
 * `message-pane-header.tsx` does when `threadTitle !== null`, and it was a real defect
 * THEN, because threads were not part of the story: the shape changed under the reader
 * for no reason they could see, so it read as a glitch.
 *
 * ⚠ **v3 MAKES THE THREAD THE POINT, so the same behaviour is now the CORRECT face.**
 * The scene opens a thread deliberately, and the breadcrumb's channel crumb is the
 * control the cursor uses to come back out (`cursor-to-crumb` / `click-crumb`). Nothing
 * was fixed to make this work and nothing is suppressed: the objection was about the
 * STORY, not the component.
 *
 * ⚠ **AND ONE PANE STILL RENDERS ONE VIEW.** `thread === null` IS the channel view, so
 * a thread and the channel cannot both be on screen. That is exactly why step 8 walks
 * the cursor back to the channel with the agent view left open, rather than trying to
 * animate the channel underneath an open thread.
 */
export type StepId =
  // 1. The team talks about the debt piling up.
  | "channel-base"
  | "channel-samuel"
  // 2. Each person launches their own orchestrator.
  | "launch-1"
  | "launch-2"
  | "launch-3"
  // 3. The orchestrators go and look at the stack.
  | "scout-1"
  | "scout-2"
  // 4. They split the work between themselves. No human assigns anything.
  | "split-1"
  | "split-2"
  | "split-3"
  // 5. Each opens its own thread, which is what draws the cards.
  | "thread-1"
  | "thread-2"
  | "thread-3"
  // 6. The cursor presses a card's own "Open thread".
  | "cursor-to-thread"
  | "click-thread"
  | "thread-open"
  // …and inside, the orchestrator launches its coders and briefs each one.
  | "thread-launch-1"
  | "thread-launch-2"
  | "thread-launch-3"
  | "brief-1"
  | "brief-2"
  | "brief-3"
  | "coder-ack"
  // 7. The cursor opens one coder's agent view. The Agents tab comes first because the
  //    info column has to be ON that tab for an "Open" button to exist at all.
  | "cursor-to-tab"
  | "click-tab"
  | "tab-open"
  | "cursor-to-agent"
  | "click-agent"
  | "agent-open"
  | "dm-user-1"
  | "dm-agent-1"
  // 8. Back to the channel through the crumb, agent view left OPEN, and from here
  //    the private turns and the channel interleave.
  | "cursor-to-crumb"
  | "click-crumb"
  | "concurrent-1"
  | "concurrent-2"
  | "dm-user-2"
  | "dm-agent-2"
  | "concurrent-3"
  | "concurrent-4"
  // 9. The cursor opens the flakes task from the composer's pill, and Debt Triage finishes it.
  | "cursor-to-tasks"
  | "click-tasks"
  | "cursor-to-task"
  | "click-task"
  | "task-open"
  | "task-tick-1"
  | "task-tick-2"
  | "task-note"
  | "cursor-to-task-crumb"
  | "click-task-crumb"
  | "task-resolved"
  | "hold"
  | "reset-fade";

/** Ordered beats; `dur` = ms the timeline sits on that step before advancing. */
export const STEPS: ReadonlyArray<{ id: StepId; dur: number }> = [
  { id: "channel-base", dur: 1500 },
  { id: "channel-samuel", dur: 1600 },
  { id: "launch-1", dur: 1100 },
  { id: "launch-2", dur: 1100 },
  { id: "launch-3", dur: 1200 },
  // The scouting lines are the longest reads in the channel, so they sit longest.
  { id: "scout-1", dur: 2100 },
  { id: "scout-2", dur: 2100 },
  { id: "split-1", dur: 1900 },
  { id: "split-2", dur: 1800 },
  { id: "split-3", dur: 1500 },
  { id: "thread-1", dur: 1300 },
  { id: "thread-2", dur: 1300 },
  { id: "thread-3", dur: 1300 },
  { id: "cursor-to-thread", dur: 1200 },
  { id: "click-thread", dur: 550 },
  { id: "thread-open", dur: 1300 },
  // Three launches in a row are one gesture, so they go quickly.
  { id: "thread-launch-1", dur: 900 },
  { id: "thread-launch-2", dur: 900 },
  { id: "thread-launch-3", dur: 900 },
  { id: "brief-1", dur: 1900 },
  { id: "brief-2", dur: 1900 },
  { id: "brief-3", dur: 1900 },
  { id: "coder-ack", dur: 1400 },
  { id: "cursor-to-tab", dur: 1100 },
  { id: "click-tab", dur: 550 },
  { id: "tab-open", dur: 1100 },
  { id: "cursor-to-agent", dur: 1200 },
  { id: "click-agent", dur: 550 },
  { id: "agent-open", dur: 1500 },
  { id: "dm-user-1", dur: 1700 },
  { id: "dm-agent-1", dur: 2300 },
  // ⚠ **THE CURSOR LEAVES THE THREAD WITH THE AGENT VIEW STILL OPEN** (Samuel,
  // 2026-10-12, step 8). One pane renders one view, so the channel cannot animate
  // underneath an open thread; the crumb is the real control that gets us back, and
  // the agent view survives the switch because it is a SIBLING of the pane, not a
  // child of it (`demo-scene.tsx`). From here the private turns and the channel
  // interleave, which is the whole point of the beat order below.
  { id: "cursor-to-crumb", dur: 1100 },
  { id: "click-crumb", dur: 550 },
  { id: "concurrent-1", dur: 1900 },
  { id: "concurrent-2", dur: 1200 },
  { id: "dm-user-2", dur: 1600 },
  { id: "dm-agent-2", dur: 2200 },
  { id: "concurrent-3", dur: 1800 },
  { id: "concurrent-4", dur: 1500 },
  { id: "cursor-to-tasks", dur: 1100 },
  { id: "click-tasks", dur: 550 },
  { id: "cursor-to-task", dur: 1000 },
  { id: "click-task", dur: 550 },
  { id: "task-open", dur: 1300 },
  { id: "task-tick-1", dur: 1200 },
  { id: "task-tick-2", dur: 1200 },
  { id: "task-note", dur: 2000 },
  { id: "cursor-to-task-crumb", dur: 1100 },
  { id: "click-task-crumb", dur: 550 },
  { id: "task-resolved", dur: 1900 },
  { id: "hold", dur: 2500 },
  { id: "reset-fade", dur: 450 },
];

/** The loop's own length, measured rather than claimed (`demo-script.test.ts` prints it). */
export const LOOP_MS = STEPS.reduce((total, s) => total + s.dur, 0);

const INDEX: Record<StepId, number> = Object.fromEntries(
  STEPS.map((s, i) => [s.id, i]),
) as Record<StepId, number>;

export const stepIndex = (id: StepId): number => INDEX[id];
/** True once the timeline has reached (or passed) `id`. */
export const reached = (step: number, id: StepId): boolean => step >= INDEX[id];
/** True only while the timeline sits ON `id`. */
export const at = (step: number, id: StepId): boolean => step === INDEX[id];

/**
 * The design canvas. (2026-08-30) Only the WIDTH is fixed: the component scales
 * to FILL the slot (`scale = slotWidth / CANVAS_W`) and derives the height, so
 * the scene reaches both edges instead of being letterboxed. CANVAS_W is mirrored
 * by `marketing.css › .lp-demo-canvas`; keep the two in step.
 *
 * CANVAS_H is only the SEED for the derived height — what the box measures before
 * the slot has one. Nothing lays out against it.
 */
/**
 * (2026-09-17) 1280 is the desktop window's own width, measured rather than
 * picked: `dopl-desktop-app/main/spa-window.js › createSpaWindow` opens the SPA
 * at `width: 1280`, so matching it makes the hero the product at 1:1 in design
 * units.
 *
 * Nothing in the scene is shrunk — the design viewport was too wide. The canvas
 * is scaled by `slotWidth / CANVAS_W`, so a wider canvas in the same slot makes
 * every control land smaller (1480 was 1.16x denser than the real window).
 * CANVAS_W is mirrored by `marketing.css › .lp-demo-canvas`; keep the two in step.
 */
export const CANVAS_W = 1280;
export const CANVAS_H = 820;
