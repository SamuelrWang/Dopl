/** Shared fixtures for `settings-tab.test.tsx` and `settings-tab-agent.test.tsx` (split 2026-09-14, 500-line cap): the two helpers BOTH halves spend, held in one place so neither half grows a second copy that drifts. */
import { screen } from "@testing-library/react";

export const noop = () => {};

/** A settings ROW by its accessible name — `queryByRole`, so an absent row is an
 *  assertable absence rather than a throw. */
export const row = (name: string) =>
  screen.queryByRole("button", { name });
