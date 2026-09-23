/**
 * THE MAILBOX OPS' SHARED PLUMBING — one bounded hold on a directive (or direction) row and one
 * retry map, for `launch`, `end` / `rename` / `posture` and `direct` (P8-07, P8-08). What each op
 * SAYS stays in its own module; how long it waits and whether a refusal may be retried do not.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan (`tool-group-files.ts`).
 */

import type { LaunchRefusalReason } from "@dopl/client";

/** The bounded hold every mailbox op runs: default and cap. */
export const DIRECTIVE_WAIT_DEFAULT_MS = 15_000;
export const DIRECTIVE_WAIT_CAP_MS = 30_000;

/** Coarse on purpose: the far end is a human-scale toggle plus a spawn or a turn on a machine. */
export const DIRECTIVE_POLL_INTERVAL_MS = 1_500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll one mailbox row until it leaves `pending` / `claimed` or the capped wait lapses.
 *
 * ⚠ POLLS THE ROW, never an `await`: a directive is not a message and has no `seq`.
 * ⚠ A FAILED POLL ENDS THE HOLD WITH THE LAST ROW, never a throw: the request is filed and the
 * machine may still take it, so the PENDING ending (which says where to look) is the honest one.
 */
export async function holdRow<T extends { id: string; status: string }>(
  row: T,
  fetchRow: (id: string) => Promise<T>,
  waitMs: number | undefined,
): Promise<T> {
  let current = row;
  const deadline =
    Date.now() + Math.min(waitMs ?? DIRECTIVE_WAIT_DEFAULT_MS, DIRECTIVE_WAIT_CAP_MS);
  while (
    (current.status === "pending" || current.status === "claimed") &&
    Date.now() < deadline
  ) {
    await sleep(Math.min(DIRECTIVE_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    try {
      current = await fetchRow(current.id);
    } catch {
      break;
    }
  }
  return current;
}

/**
 * MAY THE CALLER ASK AGAIN? — one map over the closed refusal vocabulary for every directive
 * kind. `busy` is the only temporary word; every other answer will not change by re-issuing the
 * same ask (`no-model`: re-issue WITHOUT `model` — the doctrine's MANAGE section says so).
 * ⚠ A `Record` over the enum, so a new word cannot enter without this map accounting for it.
 */
export const LAUNCH_RETRY_ADVICE: Record<LaunchRefusalReason, "once" | "no"> = {
  cap: "no",
  busy: "once",
  "no-sdk": "no",
  "auth-hold": "no",
  "no-bridge": "no",
  "no-counterparty": "no",
  "no-identity": "no",
  "no-session": "no",
  "bad-name": "no",
  "no-chain": "no",
  "no-model": "no",
};
