/**
 * THE WEEK BAR's chips, derived from the saved tasks' schedules plus a few fixed runs. The
 * mockup's clock is pinned: week 0 is Mon Oct 26 to Sun Nov 1 2026, today is Wednesday, now is
 * 12:15. Earlier weeks read as done, later ones as upcoming. Nothing reads the real clock.
 */

import { WEEKDAYS, type RunResult, type SavedTask } from "../data/saved-tasks";
import { timeLabel } from "./schedule";

/** `upcoming` = scheduled, not started yet. */
export type ChipState = RunResult | "upcoming";

export interface WeekChip {
  id: string;
  taskId: string;
  dayIndex: number;
  /** "8:30". */
  time: string;
  title: string;
  state: ChipState;
}

/** Week 0's today (Wednesday) and now. */
export const TODAY_INDEX = 2;
export const NOW_MINUTES = 12 * 60 + 15;
export const NOW_LABEL = "12:15";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The seven days of week `offset`: "Mon" and its date. */
export function weekDays(offset: number): Array<{ name: string; date: number; month: string }> {
  return WEEKDAYS.map((name, i) => {
    const d = new Date(Date.UTC(2026, 9, 26 + offset * 7 + i));
    return { name, date: d.getUTCDate(), month: MONTHS[d.getUTCMonth()] };
  });
}

/** "Oct 26 to Nov 1". */
export function weekLabel(offset: number): string {
  const days = weekDays(offset);
  return `${days[0].month} ${days[0].date} to ${days[6].month} ${days[6].date}`;
}

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Which days a schedule runs on, as indexes 0 (Mon) to 6 (Sun). */
function runDays(task: SavedTask): number[] {
  const { frequency, day } = task.schedule;
  if (frequency === "daily") return [0, 1, 2, 3, 4, 5, 6];
  if (frequency === "weekdays") return [0, 1, 2, 3, 4];
  return [WEEKDAYS.indexOf(day)];
}

/** Week 0's runs that did not go to plan, keyed `taskId:dayIndex`. */
const WEEK0_RESULTS: Record<string, ChipState> = {
  "st-digest:0": "missed",
  "st-standup:2": "missed",
};

/** Week 0's runs that were launched by hand, not by a schedule. */
const WEEK0_LAUNCHED: Array<Omit<WeekChip, "id" | "title"> & { title?: string }> = [
  { taskId: "oo-env", dayIndex: 2, time: "9:20", state: "running" },
  { taskId: "oo-flaky", dayIndex: 2, time: "10:00", state: "done" },
  { taskId: "st-release", dayIndex: 2, time: "11:40", state: "running" },
  { taskId: "oo-pricing", dayIndex: 2, time: "14:00", state: "needs_you" },
];

function scheduledState(offset: number, dayIndex: number, time: string, key: string): ChipState {
  if (offset < 0) return "done";
  if (offset > 0) return "upcoming";
  const fixed = WEEK0_RESULTS[key];
  if (fixed) return fixed;
  if (dayIndex < TODAY_INDEX) return "done";
  if (dayIndex === TODAY_INDEX && minutes(time) < NOW_MINUTES) return "done";
  return "upcoming";
}

/** Every chip of week `offset` for these tasks, each day in time order. */
export function weekChips(tasks: readonly SavedTask[], offset: number): WeekChip[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const chips: WeekChip[] = [];
  for (const task of tasks) {
    if (!task.schedule.on) continue;
    const time = timeLabel(task.schedule.time);
    for (const dayIndex of runDays(task)) {
      const key = `${task.id}:${dayIndex}`;
      chips.push({
        id: `${offset}:${key}`,
        taskId: task.id,
        dayIndex,
        time,
        title: task.title,
        state: scheduledState(offset, dayIndex, time, key),
      });
    }
  }
  if (offset === 0) {
    for (const run of WEEK0_LAUNCHED) {
      const task = byId.get(run.taskId);
      if (task) chips.push({ ...run, id: `0:launch:${run.taskId}`, title: task.title });
    }
  }
  return chips.sort((a, b) => a.dayIndex - b.dayIndex || minutes(a.time) - minutes(b.time));
}
