"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { OPEN_SCALE_ICON_ONLY, OpenScaleIconButton } from "@/shared/ui/open-scale-button";
import { TEXT_LINK_BUTTON } from "@/shared/ui/text-link";
import { RUN_RESULT } from "../model/schedule";
import { TODAY_INDEX, weekDays, weekLabel, type ChipState, type WeekChip } from "../model/week";

/** Chips a day shows before "+N". */
const DAY_CAP = 3;

/** The chip's state mark: a check, a live dot, a hollow ring, or the amber dot for "needs you". */
function ChipMark({ state }: { state: ChipState }) {
  if (state === "done") return <Check size={10} strokeWidth={3} className="flex-none text-text-primary" aria-hidden="true" />;
  const dot =
    state === "running"
      ? "bg-success"
      : state === "needs_you"
        ? "bg-warning"
        : state === "failed"
          ? "bg-danger"
          : "border border-border-strong";
  return <span className={cn("size-1.5 flex-none rounded-full", dot)} aria-hidden="true" />;
}

const chipName = (chip: WeekChip) =>
  `${chip.time} ${chip.title}, ${chip.state === "upcoming" ? "Scheduled" : RUN_RESULT[chip.state].label}`;

/**
 * THE WEEK BAR (Samuel, 2026-10-28): seven day columns in one compact band, each day's runs as
 * small chips in time order (time, title, state mark). Today is marked; arrows step a week; a day
 * holding more than {@link DAY_CAP} runs ends in "+N", which opens the rest in place.
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
    <section aria-label="This week's runs" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="text-body font-semibold text-text-primary">{weekLabel(offset)}</h2>
        {offset !== 0 && (
          <button type="button" onClick={() => onOffset(0)} className={cn("text-caption text-text-muted", TEXT_LINK_BUTTON)}>
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

      <ol className="white-card m-0 grid list-none grid-cols-7 p-0">
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
              className={cn(
                "flex min-w-0 flex-col gap-1 border-l border-border-default p-1.5 first:border-l-0",
                today && "bg-bg-inset"
              )}
            >
              <span className="flex items-baseline gap-1 px-0.5 pb-0.5">
                <span className={cn("text-label font-medium", today ? "text-text-primary" : "text-text-muted")}>
                  {day.name}
                </span>
                <span
                  className={cn(
                    "text-label tabular-nums",
                    today
                      ? "rounded-full bg-text-primary px-1.5 font-semibold text-text-on-invert"
                      : "text-text-secondary"
                  )}
                >
                  {day.date}
                </span>
              </span>
              {shown.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => onOpen(chip)}
                  aria-label={chipName(chip)}
                  title={chipName(chip)}
                  data-state={chip.state}
                  className="flex h-5.5 min-w-0 cursor-pointer items-center gap-1 rounded-mark bg-bg-overlay px-1 text-left text-label shadow-(--shadow-hairline) transition-colors hover:bg-bg-inset-hover"
                >
                  <ChipMark state={chip.state} />
                  <span
                    className={cn(
                      "flex-none tabular-nums",
                      chip.state === "missed" ? "text-text-muted line-through" : "text-text-secondary"
                    )}
                  >
                    {chip.time}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      chip.state === "missed" || chip.state === "done" ? "text-text-muted" : "text-text-primary"
                    )}
                  >
                    {chip.title}
                  </span>
                </button>
              ))}
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setOpened(i)}
                  className={cn("self-start px-1 text-label text-text-muted", TEXT_LINK_BUTTON)}
                >
                  {`+${hidden}`}
                </button>
              )}
              {own.length === 0 && <span className="px-1 text-label text-text-disabled">No runs</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
