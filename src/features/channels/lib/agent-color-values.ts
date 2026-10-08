/**
 * **THE AGENT COLOUR BANK AS NUMBERS** — what `agent-color-pick.ts` measures distance over.
 *
 * ⚠ **NOTHING PAINTS FROM THIS FILE.** Paint stays `var(--agent-color-NN)`
 * (`agent-colors.ts › agentColorVar`) and the token layer keeps the only painted values
 * (`src/app/globals.css`, `apps/desktop-ui/src/styles/tokens.css`). The server cannot read
 * CSS when it assigns a colour, so the picker needs the same values as data.
 * ⚠ **HELD EQUAL TO BOTH CSS FILES BY `agent-color-values.test.ts`**, which parses each token
 * and fails on any difference, missing key or extra key. Change a hue in the CSS and that
 * suite tells you to change it here; the picker then re-spreads on its own.
 */
import type { AgentColorKey } from "@dopl/contracts";

/** One `oklch(L C H)` token: lightness 0-1, chroma, hue in degrees. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export const AGENT_COLOR_VALUES: Readonly<Record<AgentColorKey, Oklch>> = {
  "agent-01": { l: 0.44, c: 0.11, h: 20 },
  "agent-02": { l: 0.44, c: 0.11, h: 43 },
  "agent-03": { l: 0.44, c: 0.11, h: 65 },
  "agent-04": { l: 0.44, c: 0.11, h: 88 },
  "agent-05": { l: 0.44, c: 0.11, h: 110 },
  "agent-06": { l: 0.44, c: 0.11, h: 133 },
  "agent-07": { l: 0.44, c: 0.11, h: 155 },
  "agent-08": { l: 0.44, c: 0.11, h: 178 },
  "agent-09": { l: 0.44, c: 0.11, h: 200 },
  "agent-10": { l: 0.44, c: 0.11, h: 223 },
  "agent-11": { l: 0.44, c: 0.11, h: 245 },
  "agent-12": { l: 0.44, c: 0.11, h: 268 },
  "agent-13": { l: 0.44, c: 0.11, h: 290 },
  "agent-14": { l: 0.44, c: 0.11, h: 313 },
  "agent-15": { l: 0.44, c: 0.11, h: 335 },
  "agent-16": { l: 0.44, c: 0.11, h: 358 },
};

/** Parses `oklch(L C H)` (optional `%` on L, optional `deg`); `null` for anything else. */
export function parseOklch(text: string): Oklch | null {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.%]+\s*)?\)$/i.exec(
    text.trim()
  );
  if (!m) return null;
  const l = Number(m[1]) / (m[2] === "%" ? 100 : 1);
  return { l, c: Number(m[3]), h: Number(m[4]) };
}
