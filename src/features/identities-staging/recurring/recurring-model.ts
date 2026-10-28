/** Read helpers over the staged recurring tasks: the lines a card prints and a fresh run. */

import type { StatusTone } from "@/shared/ui/status-pill";
import type {
  RecurringRun,
  RecurringRunResult,
  RecurringSchedule,
  RecurringTask,
} from "../data/recurring-tasks";

/** "9:00", "17:00": the hour without a leading zero. */
export function timeLabel(time: string): string {
  const [h, m] = time.split(":");
  return `${Number(h)}:${m}`;
}

const DAY_NAME: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

/** "Every Monday at 9:00", "Every weekday at 17:00", or "Runs when launched". */
export function scheduleLabel(schedule: RecurringSchedule): string {
  if (!schedule.on) return "Runs when launched";
  const at = `at ${timeLabel(schedule.time)}`;
  if (schedule.frequency === "daily") return `Every day ${at}`;
  if (schedule.frequency === "weekdays") return `Every weekday ${at}`;
  return `Every ${DAY_NAME[schedule.day]} ${at}`;
}

/** The next start a schedule implies, as a fixed label (the mockup has no clock). */
export function nextRunFor(schedule: RecurringSchedule): string | null {
  if (!schedule.on) return null;
  const at = timeLabel(schedule.time);
  return schedule.frequency === "weekly" ? `${schedule.day} ${at}` : `Tomorrow ${at}`;
}

/** The identities a task launches, lead first, each once. */
export function identitiesOf(task: RecurringTask): string[] {
  return [...new Set([task.leadId, ...task.subtasks.map((s) => s.identityId)])];
}

export const RUN_RESULT: Record<RecurringRunResult, { label: string; tone: StatusTone }> = {
  running: { label: "Running", tone: "live" },
  done: { label: "Done", tone: "done" },
  failed: { label: "Failed", tone: "attention" },
};

export function latestRun(task: RecurringTask): RecurringRun | null {
  return task.runs[0] ?? null;
}

let nextRunId = 0;

/** A run the viewer just launched: nothing done yet. */
export function launchedRun(task: RecurringTask): RecurringRun {
  nextRunId += 1;
  return {
    id: `run-new-${nextRunId}`,
    when: "Just now",
    startedBy: "You",
    result: "running",
    done: 0,
    total: task.subtasks.length,
  };
}
