"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { OPEN_SCALE_ICON_ONLY, OpenScaleIconButton } from "@/shared/ui/open-scale-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { TEXT_LINK_BUTTON } from "@/shared/ui/text-link";
import { RUN_RESULT } from "../model/schedule";
import { TODAY_INDEX, capDay, weekDays, weekLabel, type ChipState, type WeekChip } from "../model/week";
import styles from "../tasks.module.css";

/** Quiet run cards a day shows before "+N"; loud ones always show (`week.ts › capDay`). */
const DAY_CAP = 3;

const stateLabel = (state: ChipState) => (state === "upcoming" ? "Scheduled" : RUN_RESULT[state].label);

/** Done and missed runs are past: their titles step down to secondary, never to muted. */
const PAST: ReadonlySet<ChipState> = new Set<ChipState>(["done", "missed"]);

/**
 * THE WEEK BAR (Samuel, 2026-10-28): ONE horizontal band of day boxes, Mon to Sun left to right
 * (`tasks.module.css › .week`, never stacks, scrolls sideways when narrow; the weekend tracks are
 * narrower). The header is the range with its arrows beside it. Each day is a grey well with a
 * weekday + date head over a hairline, holding its runs as small cards: time, the task name, a
 * state word when it matters, and a state bar on the leading edge that carries the state's weight.
 * Today keeps the well and gains a hairline ring and an ink head. A day with no runs is an
 * outline only.
 */
export function WeekBar({
  chips,
  offset,
  onOffset,
  onOpen,
}: {
  chips: readonly WeekChip[];
  offset: number;
  onOffset: (next: number) => void;
  onOpen: (chip: WeekChip) => void;
}) {
  const [opened, setOpened] = useState<number | null>(null);
  const days = weekDays(offset);

  return (
    <section aria-label="This week's runs" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="text-heading font-semibold tabular-nums text-text-primary">{weekLabel(offset)}</h2>
        <span className="flex items-center gap-1">
          <OpenScaleIconButton aria-label="Previous week" onClick={() => onOffset(offset - 1)}>
            <ChevronLeft size={OPEN_SCALE_ICON_ONLY} aria-hidden="true" />
          </OpenScaleIconButton>
          <OpenScaleIconButton aria-label="Next week" onClick={() => onOffset(offset + 1)}>
            <ChevronRight size={OPEN_SCALE_ICON_ONLY} aria-hidden="true" />
          </OpenScaleIconButton>
        </span>
        {offset !== 0 && (
          <button
            type="button"
            onClick={() => onOffset(0)}
            className={cn("text-caption text-text-secondary", TEXT_LINK_BUTTON)}
          >
            Back to this week
          </button>
        )}
      </div>

      <ol className={cn(styles.week, "m-0 list-none p-0")}>
        {days.map((day, i) => {
          const today = offset === 0 && i === TODAY_INDEX;
          const own = chips.filter((c) => c.dayIndex === i);
          const { shown, hidden } = opened === i ? { shown: own, hidden: 0 } : capDay(own, DAY_CAP);
          return (
            <li
              key={day.name}
              aria-label={`${day.name} ${day.month} ${day.date}${today ? ", today" : ""}`}
              aria-current={today ? "date" : undefined}
              className={cn(
                styles.day,
                today && styles.dayToday,
                own.length === 0 && styles.dayEmpty
              )}
            >
              <span className={styles.dayHead}>
                <span
                  className={cn(
                    "text-label font-medium uppercase tracking-wide",
                    today ? "text-text-primary" : "text-text-secondary"
                  )}
                >
                  {today ? `${day.name} · Today` : day.name}
                </span>
                <span
                  className={cn(
                    "text-lead font-semibold tabular-nums",
                    own.length === 0 ? "text-text-secondary" : "text-text-primary"
                  )}
                >
                  {`${day.month} ${day.date}`}
                </span>
              </span>
              {shown.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => onOpen(chip)}
                  aria-label={`${chip.time} ${chip.title}, ${stateLabel(chip.state)}`}
                  data-state={chip.state}
                  className={styles.run}
                >
                  <span className="text-label font-medium tabular-nums text-text-secondary">{chip.time}</span>
                  <span
                    className={cn(
                      styles.runTitle,
                      "text-body font-medium leading-snug",
                      PAST.has(chip.state) ? "text-text-secondary" : "text-text-primary"
                    )}
                  >
                    {chip.title}
                  </span>
                  {(chip.state === "running" ||
                    chip.state === "needs_you" ||
                    chip.state === "failed" ||
                    chip.state === "missed") && (
                    <StatusPill bare dot={chip.state !== "missed"} tone={RUN_RESULT[chip.state].tone}>
                      {stateLabel(chip.state)}
                    </StatusPill>
                  )}
                </button>
              ))}
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
