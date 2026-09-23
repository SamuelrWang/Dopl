/**
 * Shared mailbox-op plumbing: one bounded hold on a directive (or direction) row and one retry map,
 * for `launch`, `end` / `rename` / `posture` and `direct`. What each op says stays in its own module.
 * `channel-` filename prefix is required by the parity split-scan (`tool-group-files.ts`).
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
 * Polls the row, never an `await`: a directive is not a message and has no `seq`.
 * A failed poll ends the hold with the last row, never a throw — the request is filed and may still be taken.
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
 * May the caller ask again? One map over the closed refusal vocabulary for every directive kind.
 * `busy` is the only temporary word (`no-model`: re-issue without `model`, per `channel-doctrine.ts › MANAGE`).
 * A `Record` over the enum, so a new word cannot enter without this map accounting for it.
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
