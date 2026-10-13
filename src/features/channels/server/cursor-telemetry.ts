import "server-only";

import { isCursorToken } from "../lib/cursor-format";

/**
 * **WHICH CURSOR FORM EACH ACCEPT SURFACE RECEIVES** (B6-4, 2026-10-13).
 *
 * The integer cursor has no end date on purpose (Per-Channel Numbering Design,
 * B6 §3): every client derives its cursor from `message.seq`, so integers keep
 * arriving until each client is released AND adopted, and adoption is invisible
 * from the server. Counting what arrives, per surface, lets the sunset be dated
 * by measurement instead of in advance.
 *
 * ⚠ **NO DB WRITE (F-072).** A read-triggered write on a realtime table caused
 * the CPU incident. This module writes one tagged log line, the same path and
 * shape as `[await-hold]`, and imports no database client.
 *
 * ⚠ **BOUNDED, AND NOTHING IDENTIFYING.** Every field comes from a closed set:
 * 5 surfaces x 4 forms x 3 capability states = 60 distinct lines, forever. The
 * cursor VALUE is never logged in any form, and neither is any channel,
 * workspace or user id: the line carries no scope, because the surface already
 * fixes it and a scope key would embed an id.
 */

/** The header the fixed hold script sends. Lower-case: `Headers.get` folds case. */
export const CURSOR_CAPABILITY_HEADER = "x-dopl-cursor";

/** Its only recognised value. A new capability gets a new value, not a new meaning. */
export const CURSOR_CAPABILITY_VALUE = "opaque-1";

/**
 * Every place a cursor is accepted. Per surface rather than per scope kind:
 * the two account surfaces share a scope, as do the per-channel hold and the
 * messages read, and the sunset question is "who still sends integers, where".
 */
export type CursorSurface =
  | "channel-await"
  | "workspace-await"
  | "account-messages"
  | "account-status"
  | "messages-read";

/**
 * What arrived. `token` means token-SHAPED (the `dc1.` prefix): one that then
 * fails to decode is still refused by the caller, but it was sent as a token.
 * `other` is a string that is neither, and is refused; its rate is a signal
 * (a client mangling cursors).
 */
export type CursorForm = "absent" | "integer" | "token" | "other";

export function cursorForm(value: string | number | undefined): CursorForm {
  if (value === undefined) return "absent";
  if (typeof value === "number") return "integer";
  return isCursorToken(value) ? "token" : "other";
}

/**
 * Did the caller advertise that it round-trips opaque cursors?
 *
 * ⚠ **A CAPABILITY HINT, NEVER AN AUTHORIZATION SIGNAL**, the rule
 * `shared/auth/runtime-header.ts` sets for every `X-Dopl-*` header. Here it is
 * only ever counted.
 */
export function cursorCapability(headers: Headers): boolean {
  return headers.get(CURSOR_CAPABILITY_HEADER) === CURSOR_CAPABILITY_VALUE;
}

export type CursorTelemetry = {
  surface: CursorSurface;
  /**
   * `undefined` means NOT LOOKED AT (an in-process caller with no request) and
   * logs as `unknown`, never `no`: conflating the two would corrupt the count.
   */
  advertised?: boolean;
};

/**
 * One line per accepted cursor. ⚠ **FAIL-SOFT.** This sits on the read path, so
 * a throw here would turn a counter into an outage; failures are swallowed.
 * `DOPL_CURSOR_DIAG=0` silences it, the same switch shape as `DOPL_AWAIT_DIAG`.
 */
export function logCursorForm(
  value: string | number | undefined,
  telemetry: CursorTelemetry,
): void {
  try {
    if (process.env.DOPL_CURSOR_DIAG === "0") return;
    const advertised =
      telemetry.advertised === undefined
        ? "unknown"
        : telemetry.advertised
          ? "yes"
          : "no";
    console.log(
      `[cursor-form] surface=${telemetry.surface} form=${cursorForm(value)}` +
        ` advertised=${advertised}`,
    );
  } catch {
    // A counter may never be the reason a read failed.
  }
}
