import "server-only";

/**
 * 🔒 **THE WEB SIDE OF "A TOOL CALL THAT WAS NOT CHARGED SAYS SO" (2026-09-14).**
 *
 * ⚠ **THE FAILURE THIS EXISTS FOR IS A MIS-ORDERED DEPLOY, AND IT WAS SILENT ON
 * THIS SIDE.** `POST /api/mcp/credits/consume` FAILS OPEN by decision — a DB
 * blip must not brick every agent (`route.ts › failOpen`, INVARIANTS §10) — and
 * answers `{ allowed: true, degraded: true, wallet: null, used: 0, limit: 0 }`.
 * Ship the web app before the migration applies and a missing RPC signature is a
 * `PGRST202`, not a 500: every MCP tool call in the estate then runs UNMETERED,
 * for as long as the gap lasts. Two things were missing:
 *   1. the log was a `console.error` **PER CALL** — under a real outage that is
 *      one line per tool call per agent, which buries itself and everything
 *      beside it. A deploy-ordering bug is a STATE, not an event; one line
 *      states it.
 *   2. **nothing web-side showed it at all.** The Settings meter and the /home
 *      bar read the same zeroes they read for every other degraded posture, so
 *      the operator saw `0` and had no way to tell "nothing was spent" from
 *      "nothing was measured".
 *
 * ⚠ **THIS MIRRORS `packages/mcp-server/src/credits-unmetered.ts`, IT DOES NOT
 * SHARE WITH IT.** That module is the AGENT-facing half (the once-per-process
 * log plus the per-call `_dopl_status` footer note); this is the OPERATOR-facing
 * half (the once-per-process log plus a field on `GET /api/billing/status`).
 * The two trees cannot import each other — the MCP server is a separate build
 * kept external by `next.config.ts › serverExternalPackages` — so the SHAPE is
 * copied deliberately and each side owns its own audience.
 *
 * 🔒 ⚠ **THE STATE IS PROCESS-LOCAL, AND THAT IS A STATED LIMITATION RATHER
 * THAN AN OVERSIGHT.** `unmeteredSince()` answers for THE SERVER PROCESS THAT
 * HANDLES THE STATUS READ, so on a multi-instance deployment a status read
 * served by an instance that never failed open reports `null` while a sibling
 * instance is failing open. It is therefore a **HINT THAT NEVER FALSELY
 * ACCUSES**: a set value means THIS process really did fail open, and a `null`
 * means only that this process has not. The honest alternative — a row per
 * incident — puts a WRITE on the failure path of the billing outage it is
 * reporting, which is the one place a new write must not go. When every
 * instance is affected (the deploy-ordering case this exists for) every
 * instance reports it, which is the case that matters.
 *
 * ⚠ **IT NEVER REFUSES AND NEVER RETRIES.** Fail-open is the decision; this
 * module only makes the consequence legible.
 */

/**
 * Why a charge was not measured. ⚠ A CLOSED SET, because it is the LOG DEDUPE
 * KEY: folding the server's message into the key would defeat the
 * once-per-process rule the moment a message carried an id or a timestamp.
 */
export type UnmeteredReason =
  /** `consumeMcpCredits` threw — a dead RPC (`PGRST202` between a web deploy
   *  and its migration), a network fault, a 5xx from Postgres. */
  | "consume_failed";

/**
 * When THIS process first failed open and has not recovered since — the value
 * `GET /api/billing/status` publishes as `credits.unmeteredSince`.
 *
 * ⚠ **THE FIRST ONE, NOT THE LATEST.** An operator needs to know how long the
 * estate has been running free; re-stamping on every call would answer "a
 * moment ago" for an outage three hours old.
 */
let firstFailOpenIso: string | null = null;

/** ⚠ PROCESS-WIDE ON PURPOSE — the whole point is that the second occurrence is
 *  silent. ⚠ **AND IT IS NOT RE-ARMED BY {@link clearUnmetered}**: a condition
 *  that flaps would otherwise print a line per flap, which is the per-call log
 *  this replaced wearing a different shape. The FIELD re-arms; the LOG does
 *  not. Cleared only by {@link resetUnmeteredForTests}. */
const logged = new Set<UnmeteredReason>();

const LOG_HEADLINE: Record<UnmeteredReason, string> = {
  consume_failed: "the consume call FAILED and the charge failed open",
};

/**
 * Record that a charge ran UNMETERED, and say so in the log the FIRST time this
 * process sees this reason.
 *
 * ⚠ **`detail` IS LOGGED, NEVER KEYED ON** — see {@link UnmeteredReason}.
 * ⚠ Never throws: a throw here would turn a billing outage into a failed tool
 * call, which is the exact inversion the fail-open decision exists to prevent.
 */
export function recordUnmetered(reason: UnmeteredReason, detail: string): void {
  firstFailOpenIso ??= new Date().toISOString();
  if (logged.has(reason)) return;
  logged.add(reason);
  console.error(
    `[credits] ${LOG_HEADLINE[reason]} — MCP tool calls are running UNMETERED ` +
      `since ${firstFailOpenIso}. ${detail} ⚠ This line is printed ONCE per ` +
      `process per reason; the condition may be continuing. ` +
      `GET /api/billing/status reports it as credits.unmeteredSince for as ` +
      `long as it lasts.`
  );
}

/**
 * A charge was MEASURED, so this process is no longer failing open.
 *
 * ⚠ **ANY ANSWER THAT DID NOT THROW CLEARS IT, INCLUDING A `degraded` ONE.**
 * The unmetered POSTURE (`credits-meter.ts › unmetered` — a container with no
 * active owner, a peer's meter) is a DECIDED answer the service reached on
 * purpose and reports for itself; it is not the service failing to answer, and
 * conflating the two would leave this field stuck on for every operator who
 * happens to own a link container.
 */
export function clearUnmetered(): void {
  firstFailOpenIso = null;
}

/** When this process first failed open and has not recovered since, or `null`.
 *  ⚠ Process-local — see the header. */
export function unmeteredSince(): string | null {
  return firstFailOpenIso;
}

/** ⚠ TEST-ONLY. The once-per-process Set and the sticky timestamp are both the
 *  behaviour under test, so a suite that asserts them has to be able to put the
 *  process back. */
export function resetUnmeteredForTests(): void {
  logged.clear();
  firstFailOpenIso = null;
}
