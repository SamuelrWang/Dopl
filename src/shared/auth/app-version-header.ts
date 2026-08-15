/**
 * `X-Dopl-App-Version` — which BUILD of the desktop app a request speaks for.
 * electron-updater installs ON QUIT and a background listener is quit ~never, so
 * a Mac can run a stale build for days; stamping the poster's build makes the
 * skew readable from the other machine.
 *
 * ⚠ The header is the ONLY input: caller-supplied `metadata.appVersion` is
 * stripped in `resolvePostMetadata` (the single stamping point). Only a plain
 * `major.minor.patch` (+ optional short pre-release tag) counts — a value that
 * reaches an operator's screen must not be attacker-chosen free text.
 *
 * ⚠ DIAGNOSTIC HINT, NEVER AN AUTHORIZATION SIGNAL (same framing as
 * `runtime-header.ts`). Any device-token holder can set it, so it cannot attest
 * what code ran. Nothing may gate access, capability, or trust on it.
 *
 * ⚠ THE MINIMUM-VERSION GATE DOES NOT RIDE ON THIS HEADER, and must not: a 426
 * keyed on it would gate ACCESS on a caller-settable value, and would reach
 * pre-gate builds as unexplained API failures. The floor lives in
 * `src/shared/version/desktop-floor.ts` and the client PULLS it from
 * `GET /api/version`, blocking itself in `dopl-desktop-app/main/min-version.js`.
 */

export const APP_VERSION_HEADER = "x-dopl-app-version";

/** `1.7.15`, optionally `1.8.0-beta.2`. ⚠ Narrow on purpose: echoed back to a
 *  human on another machine, so it is a version or it is nothing. */
const APP_VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,16})?$/;

/** Recognized app version, or undefined. ⚠ No trimming, no coercion — the only
 *  sender is our own desktop build, so a near-miss is a bug to notice. */
export function readAppVersionHeader(request: {
  headers: Headers;
}): string | undefined {
  const raw = request.headers.get(APP_VERSION_HEADER);
  return raw && APP_VERSION_RE.test(raw) ? raw : undefined;
}

/** Re-narrow a version that crossed a layer boundary (auth ctx → channel ctx).
 *  ⚠ Same predicate applied twice, so no other path can widen it. */
export function narrowAppVersion(
  value: string | null | undefined
): string | undefined {
  return typeof value === "string" && APP_VERSION_RE.test(value)
    ? value
    : undefined;
}
