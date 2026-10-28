/**
 * The task lane's literals hand-mirror the web tree, which this package cannot import. `satisfies`
 * keeps each set inside the contract's union; these cases hold it equal to the route's, whose
 * `closedEnum` proves the route's set IS the union.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUBTASK_STATES, TASK_STATUSES } from "./channel-schema-task-fields";
import { TASK_ASSIGNEE_MAX } from "./channel-task-actor";

const WEB_SRC = new URL("../../../../src/", import.meta.url).href;
const web = (file: string) => readFileSync(new URL(`${WEB_SRC}${file}`), "utf8");

/** The string literals of the `closedEnum<Union>()([...])` declaration for `union`. */
function routeSet(union: string): string[] {
  const m = new RegExp(`closedEnum<${union}>\\(\\)\\(\\[([^\\]]*)\\]\\)`).exec(web("features/channels/schema-tasks.ts"));
  expect(m, `schema-tasks.ts no longer declares closedEnum<${union}>`).not.toBeNull();
  return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("the task lane's literals match the route", () => {
  it("status and subtask state are the route's sets, in its order", () => {
    expect([...TASK_STATUSES]).toEqual(routeSet("TaskStatus"));
    expect([...SUBTASK_STATES]).toEqual(routeSet("SubtaskState"));
  });

  it("the assignee cap is CHANNEL_TASK_ASSIGNEE_MAX", () => {
    const declared = /CHANNEL_TASK_ASSIGNEE_MAX = (\d+)/.exec(web("features/channels/constants.ts"));
    expect(declared, "the web constant moved or was renamed").not.toBeNull();
    expect(Number(declared![1])).toBe(TASK_ASSIGNEE_MAX);
  });
});
