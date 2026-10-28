"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { OPEN_SCALE_ICON_ONLY, OpenScaleIconButton } from "@/shared/ui/open-scale-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { TEXT_LINK_BUTTON } from "@/shared/ui/text-link";
import type { SavedTask } from "../data/saved-tasks";
import { facesOf } from "../model/assignment";
import { RUN_RESULT } from "../model/schedule";
import { TODAY_INDEX, weekDays, weekLabel, type ChipState, type WeekChip } from "../model/week";
import styles from "../tasks.module.css";
import { IdentityMark, TeamChipFace } from "./assignee";

/** Run cards a day shows before "+N". */
const DAY_CAP = 3;

/** 11px uppercase section label, the study-notes bento head. */
const BENTO_LABEL = "text-label font-semibold uppercase tracking-wide";

const stateLabel = (state: ChipState) => (state === "upcoming" ? "Scheduled" : RUN_RESULT[state].label);

/** The run's tiny assignee face: the team's, or the first identity's. */
function RunFace({ task }: { task: SavedTask | undefined }) {
  if (!task) return null;
  if (task.assignment.kind === "team") return <TeamChipFace teamId={task.assignment.teamId} />;
  const first = facesOf(task)[0];
  return first ? <IdentityMark id={first} size="xs" /> : null;
}

/**
 * THE WEEK BAR (Samuel, 2026-10-28): ONE horizontal band of seven equal day boxes, Mon to Sun
 * left to right (`tasks.module.css › .week`, never stacks, scrolls sideways when narrow). Each
 * day is a bento well holding its runs as small cards: time and state, the task name, a tiny face,
 * a state bar on the leading edge. Today is lifted with an ink hairline.
 */
export function WeekBar({
  chips,
  taskOf,
  offset,
  onOffset,
  onOpen,
}: {
  chips: readonly WeekChip[];
  taskOf: (id: string) => SavedTask | undefined;
  offset: number;
  onOffset: (next: number) => void;
  onOpen: (chip: WeekChip) => void;
}) {
  const [opened, setOpened] = useState<number | null>(null);
  const days = weekDays(offset);

  return (
    <section aria-label="This week's runs" className="flex min-w-0 flex-col gap-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className={cn(BENTO_LABEL, "text-text-secondary")}>Week</h2>
        <span className="text-body font-semibold text-text-primary">{weekLabel(offset)}</span>
        {offset !== 0 && (
          <button
            type="button"
            onClick={() => onOffset(0)}
            className={cn("text-caption text-text-muted", TEXT_LINK_BUTTON)}
          >
            Back to this week
          </button>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <OpenScaleIconButton aria-label="Previous week" onClick={() => onOffset(offset - 1)}>
            <ChevronLeft size={OPEN_SCALE_ICON_ONLY} aria-hidden="true" />
          </OpenScaleIconButton>
          <OpenScaleIconButton aria-label="Next week" onClick={() => onOffset(offset + 1)}>
            <ChevronRight size={OPEN_SCALE_ICON_ONLY} aria-hidden="true" />
          </OpenScaleIconButton>
        </span>
      </div>

      <ol className={cn(styles.week, "m-0 list-none p-0")}>
        {days.map((day, i) => {
          const today = offset === 0 && i === TODAY_INDEX;
          const own = chips.filter((c) => c.dayIndex === i);
          const shown = opened === i ? own : own.slice(0, DAY_CAP);
          const hidden = own.length - shown.length;
          return (
            <li
              key={day.name}
              aria-label={`${day.name} ${day.month} ${day.date}${today ? ", today" : ""}`}
              aria-current={today ? "date" : undefined}
              className={cn("card-well", styles.day, today && styles.dayToday)}
            >
              <span className={styles.dayHead}>
                <span className={cn(BENTO_LABEL, today ? "text-text-primary" : "text-text-muted")}>
                  {day.name}
                </span>
                <span
                  className={cn(
                    "text-caption tabular-nums",
                    today ? "font-semibold text-text-primary" : "text-text-secondary"
                  )}
                >
                  {today ? `Today ${day.date}` : `${day.month} ${day.date}`}
                </span>
              </span>
              {shown.map((chip) => {
                const missedOrDone = chip.state === "missed" || chip.state === "done";
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => onOpen(chip)}
                    aria-label={`${chip.time} ${chip.title}, ${stateLabel(chip.state)}`}
                    data-state={chip.state}
                    className={styles.run}
                  >
                    <span className={styles.runHead}>
                      <span
                        className={cn(
                          "text-label font-medium tabular-nums",
                          chip.state === "missed" ? "text-text-muted line-through" : "text-text-secondary"
                        )}
                      >
                        {chip.time}
                      </span>
                      <span className="ml-auto flex items-center">
                        <RunFace task={taskOf(chip.taskId)} />
                      </span>
                    </span>
                    <span
                      className={cn(
                        styles.runTitle,
                        "text-caption font-semibold leading-snug",
                        missedOrDone ? "text-text-muted" : "text-text-primary"
                      )}
                    >
                      {chip.title}
                    </span>
                    {(chip.state === "running" || chip.state === "needs_you" || chip.state === "missed") && (
                      <StatusPill
                        bare
                        dot={chip.state !== "missed"}
                        tone={RUN_RESULT[chip.state].tone}
                      >
                        {stateLabel(chip.state)}
                      </StatusPill>
                    )}
                  </button>
                );
              })}
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setOpened(i)}
                  className={cn(styles.more, "text-label font-medium text-text-secondary", TEXT_LINK_BUTTON)}
                >
                  {`+${hidden} more`}
                </button>
              )}
              {own.length === 0 && <span className="px-0.5 text-label text-text-muted">No runs</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
