// THE 2026-09-04 MID-SESSION SIGN-OUT — two holders of ONE refresh-token family.
//
// FIELD EVIDENCE, so the next reader does not have to re-derive it.
//   listener.log — three real drops (2026-09-03T20:05:42Z, 2026-09-04T01:44:45Z,
//   2026-09-04T23:08:49Z), each a clean `auth: refresh failed — HTTP 400` → three
//   definitive rejections → "DROPPING the stored session". Main's own cadence was
//   PERFECT throughout: one rotation every 58 min (exp − NEAR_EXPIRY_SEC), no gaps.
//   auth.refresh_tokens — every chain is single-child (one rotation, one heir) right up
//   to the last row, which is `revoked=true` with ZERO children at a time that is not on
//   main's cadence: id 3780 revoked 19:36:41Z (created 19:07:11Z), 3783 revoked
//   01:33:57Z (created 00:46:09Z), 3788 revoked 22:45:16Z (created 22:10:21Z).
//   GoTrue's request log — the revocations ARE requests, and they name their cause:
//     01:33:57Z POST /token grant_type=refresh_token → 400 error_code
//       `refresh_token_already_used`, error "Possible abuse attempt: 3781",
//       referer https://www.usedopl.com/, remote_addr 76.175.122.196
//     22:45:16Z the same, "Possible abuse attempt: 3784", remote_addr 18.144.29.137
//   3781 and 3784 are the SIGN-IN tokens of their sessions — the ones the browser was
//   handed at /auth/callback and never rotated. Reusing a rotated token revokes the
//   whole family, which is what killed main's live token minutes before its next
//   scheduled refresh 400'd.
//
// THE CAUSE, therefore, was never a second refresher inside the app (the bundled SPA
// holds no Supabase client at all — `apps/desktop-ui` has no @supabase dependency, and
// `src/shared/supabase/browser.ts` throws in that runtime). It was the WEB leg of the
// desktop sign-in: `/auth/callback?desktop=1` exchanged the PKCE code with the
// cookie-WRITING server client, so the system browser kept the very session the app then
// adopted — a second holder that never rotates and eventually refreshes once.
//
// THE FIX, pinned below: the desktop leg exchanges with a READ-ONLY client, hands the
// session over in the URL fragment, and the handoff page constructs no Supabase client
// (its `detectSessionInUrl` would otherwise re-plant the session from that very
// fragment). ONE FAMILY, ONE HOLDER.
//
// Source-extraction idiom, same as auth-rejected-token.test.mjs: these modules are
// CommonJS-plus-electron or TSX, so they are read as TEXT, not imported.
//
// Run: `node --test dopl-desktop-app/test/desktop-handoff-one-family.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const WEB = (p) => readFileSync(join(HERE, "..", "..", "src", p), "utf8");

const RULES = MAIN("auth-token-rules.js");
const AUTH = MAIN("auth.js");
const CALLBACK = WEB("app/auth/callback/route.ts");
const HANDOFF = WEB("app/auth/desktop-handoff/page.tsx");
const ADMIN = WEB("shared/supabase/admin.ts");

// Comments carry the whole story of this bug, so a NEGATIVE grep has to read code only —
// otherwise the very sentence explaining "this page must not build a Supabase client"
// would fail the assertion that it does not. Block comments go first (that is where the
// prose lives); the line-comment strip refuses to eat a scheme's `//`.
const codeOnly = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ── The 400's CODE is logged (never its token) ──────────────────────────────
// "HTTP 400" alone cannot tell `refresh_token_not_found` (the family is gone) from
// `refresh_token_already_used` (someone else has it) — and that distinction is the whole
// difference between "re-sign-in" and "there is a second holder". It cost three
// incidents, a refresh_tokens dump and a GoTrue log to answer once.
const refreshFailureCode = new Function(
  `${fnOf(RULES, "refreshFailureCode")}; return refreshFailureCode;`
)();

test("refreshFailureCode reports GoTrue's enum and nothing else", () => {
  assert.equal(
    refreshFailureCode(
      '{"code":400,"error_code":"refresh_token_already_used","msg":"Invalid Refresh Token: Already Used"}'
    ),
    "refresh_token_already_used"
  );
  assert.equal(refreshFailureCode('{"error":"invalid_grant"}'), "invalid_grant");
  assert.equal(refreshFailureCode('{"error_code":"refresh_token_not_found"}'), "refresh_token_not_found");
});

test("refreshFailureCode never echoes a body it does not recognise", () => {
  // I11. An unparseable body, a non-enum code, a free-text message and an object are all
  // '' — the log must never become a channel for whatever the server chose to send back.
  assert.equal(refreshFailureCode("<html>502 Bad Gateway</html>"), "");
  assert.equal(refreshFailureCode(""), "");
  assert.equal(refreshFailureCode(null), "");
  assert.equal(refreshFailureCode('{"error":"Invalid Refresh Token: Already Used"}'), "");
  assert.equal(refreshFailureCode('{"error_code":{"nested":"x"}}'), "");
  assert.equal(refreshFailureCode(`{"error_code":"${"a".repeat(65)}"}`), "");
  // The shape a leaked credential would have (dots, dashes, base64url) is not the enum shape.
  assert.equal(refreshFailureCode('{"error_code":"eyJhbGciOi.J9-x_y"}'), "");
});

test("refreshInner logs the code with the status", () => {
  const inner = fnOf(AUTH, "refreshInner");
  assert.match(inner, /refreshFailureCode\(/, "the 400 body must be classified");
  assert.match(
    inner,
    /authFail\('refresh failed', `HTTP \$\{res\.status\}\$\{code \? ` \(\$\{code\}\)` : ''\}`\)/,
    "status AND code, in the one line the field log is read from"
  );
});

// ── ONE FAMILY, ONE HOLDER ─────────────────────────────────────────────────
// Each assertion below is a way the second holder came back. Do not relax one without
// re-reading the field evidence at the top of this file.

test("the desktop leg exchanges the code with the READ-ONLY client", () => {
  const code = codeOnly(CALLBACK);
  assert.match(
    code,
    /isDesktop\s*\?\s*createDesktopHandoffSupabaseClient\(cookieStore\)\s*:\s*createServerSupabaseClient\(cookieStore\)/,
    "desktop=1 must never reach the cookie-writing client — that write IS the bug"
  );
  // The WEB leg still writes: there the browser is the legitimate (and only) holder.
  assert.match(code, /createServerSupabaseClient\(cookieStore\)/);
});

test("createDesktopHandoffSupabaseClient writes no cookie", () => {
  const body = codeOnly(fnOf(ADMIN, "createDesktopHandoffSupabaseClient"));
  assert.match(body, /setAll\(\)\s*\{\s*\}/, "setAll must be a literal no-op");
  assert.doesNotMatch(body, /cookieStore\.set/, "a cookie write here re-arms the family split");
  assert.match(body, /getAll\(\)/, "it still READS — the PKCE code-verifier lives in the jar");
});

test("the session reaches the app through the fragment, not a cookie", () => {
  const code = codeOnly(CALLBACK);
  const redirect = codeOnly(fnOf(CALLBACK, "desktopHandoffRedirect"));
  assert.match(code, /if \(isDesktop\) \{/);
  assert.match(code, /return desktopHandoffRedirect\(request, session, desktopState\)/);
  assert.match(redirect, /access_token: session\.access_token/);
  assert.match(redirect, /refresh_token: session\.refresh_token/);
  // A fragment is never sent to a server; a query string is. This must stay a `#`.
  assert.match(redirect, /NextResponse\.redirect\(`\$\{url\.toString\(\)\}#\$\{fragment\.toString\(\)\}`\)/);
  // A `sb-*-auth-token` from an EARLIER WEB sign-in is a different family and must survive:
  // clearing it would sign the user out of the site as a side effect of signing into the app.
  assert.match(redirect, /endsWith\("-code-verifier"\)/);
  assert.doesNotMatch(redirect, /includes\("-auth-token"\)/);
});

test("the handoff page constructs no Supabase client", () => {
  const code = codeOnly(HANDOFF);
  // Not the import, not the factory, not a session read — and note WHY the import alone
  // would be fatal: createBrowserClient defaults `detectSessionInUrl` to true in a browser,
  // so merely constructing it here re-plants the session from the fragment we just read.
  assert.doesNotMatch(code, /@\/shared\/supabase/, "no supabase import");
  assert.doesNotMatch(code, /getSupabaseBrowser/, "no browser client");
  assert.doesNotMatch(code, /\.auth\./, "no GoTrue call of any kind");
  assert.match(code, /window\.location\.hash/, "the tokens come from the fragment");
  assert.match(code, /history\.replaceState/, "…and are scrubbed from history once read");
  assert.match(code, /dopl:\/\/auth#/, "…and leave only by the deep link");
});
