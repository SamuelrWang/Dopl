/**
 * `X-Dopl-App-Version` — which BUILD of the desktop app a request speaks for.
 *
 * WHY IT EXISTS (Q10): electron-updater downloads in the background and installs
 * ON QUIT, and a background listener app is quit approximately never. So a Mac
 * can run a stale build for days while its operator believes it is current.
 * That happened: a peer sat on 1.7.14 after 1.7.15 shipped, and the fix that WAS
 * released looked broken for a full debugging round — the two sides could not
 * see that they were running different code. Stamping the poster's build onto
 * the message makes the skew readable from the other machine instead of guessed.
 *
 * The header is the ONLY input, exactly like `X-Dopl-Runtime`: caller-supplied
 * `metadata.appVersion` is stripped in `resolvePostMetadata` (the single
 * stamping point), so the label cannot be spoofed through the message body.
 * Only a plain `major.minor.patch` (with an optional short pre-release tag)
 * counts — anything else (absent, blank, padded, a paragraph of prose, a
 * 4-part build number) stamps nothing, because a value that reaches an
 * operator's screen must not be attacker-chosen free text.
 *
 * A DIAGNOSTIC / ROUTING HINT, NEVER AN AUTHORIZATION SIGNAL — the same framing
 * as `runtime-header.ts`. Any holder of a device token can set this header, so
 * it cannot attest what code actually ran; it only labels what the sender says
 * it is. Nothing may gate access, capability, or trust on it, and the desktop's
 * only use is to print one line explaining a behavior gap. It fails safe in
 * both directions: an absent stamp costs a diagnostic, never a delivery, and a
 * LIED-ABOUT stamp costs a misleading log line, never a permission.
 *
 * THE MINIMUM-VERSION GATE DOES NOT RIDE ON THIS HEADER — recorded here so the
 * question is not rediscovered. Phase 4 needs old desktop builds forced forward
 * (docs/DESKTOP-MIGRATION-PLAN.md risk register), and the obvious-looking design
 * is a `426 Upgrade Required` on `/api/**` keyed on this stamp. It was rejected:
 *
 *   • It would gate ACCESS on a value any device-token holder can set, which is
 *     the one thing this contract forbids — and it would buy no coercion for the
 *     cost, because the client that lies about its version is exactly the client
 *     that would ignore the 426.
 *   • The population it would reach cannot act on it. Builds <= 1.8.0 predate the
 *     gate entirely; a 426 reaches them as unexplained API failures across every
 *     screen — strictly worse than letting a stale build keep working.
 *   • A cooperating client does not need to be told twice. It PULLS the floor
 *     from `GET /api/version` and blocks ITSELF, which puts the whole upgrade
 *     story (the screen, the download, the restart) in the one process that can
 *     actually perform it.
 *
 * So the floor lives in `src/shared/version/desktop-floor.ts` and the gate lives
 * in `dopl-desktop-app/main/min-version.js`. Nothing here changed, and nothing
 * here may.
 */

export const APP_VERSION_HEADER = "x-dopl-app-version";

/**
 * `1.7.15`, optionally `1.8.0-beta.2`. Deliberately narrow: this string is
 * echoed back to a human on another machine, so it is a version or it is
 * nothing.
 */
const APP_VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,16})?$/;

/**
 * The recognized app version this request carries, or undefined. No trimming
 * and no coercion: the one sender is our own desktop build, so a near-miss is a
 * bug to notice rather than a value to rescue. (Surrounding whitespace never
 * reaches here — the Headers layer strips it off a field value first.)
 */
export function readAppVersionHeader(request: {
  headers: Headers;
}): string | undefined {
  const raw = request.headers.get(APP_VERSION_HEADER);
  return raw && APP_VERSION_RE.test(raw) ? raw : undefined;
}

/**
 * Re-narrow a version that has already crossed a layer boundary (the auth
 * context → the channel context). Same predicate, applied twice, so no other
 * construction path can widen what counts as a version.
 */
export function narrowAppVersion(
  value: string | null | undefined
): string | undefined {
  return typeof value === "string" && APP_VERSION_RE.test(value)
    ? value
    : undefined;
}
