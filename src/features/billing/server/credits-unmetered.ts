import "server-only";

/**
 * The web side of "a tool call that was not charged says so" (2026-09-14).
 *
 * `POST /api/mcp/credits/consume` fails open by decision — a DB blip must not
 * brick every agent (`route.ts › failOpen`, INVARIANTS §10). Ship the web app
 * before its migration applies and the missing RPC signature is a `PGRST202`,
 * so the whole estate runs unmetered while both meters show the same `0` they
 * show for a measured empty month. This module logs that state once per process
 * and publishes it as a field, instead of one `console.error` per tool call.
 *
 * It mirrors `packages/mcp-server/src/credits-unmetered.ts` rather than sharing
 * with it: that module is the agent-facing half, this the operator-facing one,
 * and the two trees cannot import each other (the MCP server is kept external by
 * `next.config.ts › serverExternalPackages`).
 *
 * The state is process-local, a stated limitation: `unmeteredSince()` answers for
 * the process that served this read, so it is a hint that never falsely accuses.
 * The alternative — a row per incident — puts a write on the failure path of the
 * outage it reports. It never refuses and never retries.
 */

/**
 * Why a charge was not measured. A closed set, because it is the log dedupe key:
 * folding the server's message in would defeat the once-per-process rule the
 * moment a message carried an id or a timestamp.
 */
export type UnmeteredReason =
  /** `consumeMcpCredits` threw — a dead RPC (`PGRST202` between a web deploy
   *  and its migration), a network fault, a 5xx from Postgres. */
  | "consume_failed";

/**
 * When THIS process first failed open and has not recovered since — the value
 * `GET /api/billing/status` publishes as `credits.unmeteredSince`.
 *
 * The FIRST one, not the latest: re-stamping on every call would answer "a
 * moment ago" for an outage three hours old.
 */
let firstFailOpenIso: string | null = null;

/** Process-wide on purpose — the second occurrence is silent. Not re-armed by
 *  {@link clearUnmetered}: a flapping condition would otherwise print a line per
 *  flap. The FIELD re-arms, the LOG does not; cleared only by
 *  {@link resetUnmeteredForTests}. */
const logged = new Set<UnmeteredReason>();

const LOG_HEADLINE: Record<UnmeteredReason, string> = {
  consume_failed: "the consume call FAILED and the charge failed open",
};

/**
 * Record that a charge ran UNMETERED, and say so in the log the FIRST time this
 * process sees this reason.
 *
 * `detail` is logged, never keyed on — see {@link UnmeteredReason}. Never throws:
 * that would turn a billing outage into a failed tool call, the inversion
 * fail-open exists to prevent.
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
 * Any answer that did not throw clears it, including a `degraded` one. The
 * unmetered posture (`credits-meter.ts › unmetered` — a container with no active
 * owner, a peer's meter) is a decided answer, not a failure to answer; conflating
 * the two would leave this field stuck on for every owner of a link container.
 */
export function clearUnmetered(): void {
  firstFailOpenIso = null;
}

/** When this process first failed open and has not recovered since, or `null`.
 *  Process-local — see the header. */
export function unmeteredSince(): string | null {
  return firstFailOpenIso;
}

/** Test-only. The once-per-process Set and the sticky timestamp are both the
 *  behaviour under test, so a suite asserting them must be able to reset. */
export function resetUnmeteredForTests(): void {
  logged.clear();
  firstFailOpenIso = null;
}
