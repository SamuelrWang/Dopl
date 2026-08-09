// LAUNCH-BLOCKER P0-2: the token rotation happens AT LAUNCH, not inside the
// SPA's first API call.
//
// WHY THIS IS A TEST AND NOT A COMMENT. `performApiRequest` awaits
// `getBearerToken()`, and that read rotates in line whenever the stored token
// is inside auth-tokens' near-expiry window — which is exactly where a cold
// start lands once the app has been closed past ~80% of a token's life
// (~48 min). Paid there it is a serial network hop in FRONT of the boot
// request, on the one path with nothing else in flight to hide it. The fix is
// three lines and leaves NO observable trace in any response, so a later
// "this call does nothing, delete it" reading is the obvious way to lose it.
//
// Source-level, like the rest of this suite: `register()` is bound to electron
// IPC and a BrowserWindow, so it cannot be invoked here — but the two facts
// that matter (the prime exists, and `register` runs it) are both structural.
//
// Run: `node --test dopl-desktop-app/test/ui-bridge-auth-prime.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = readFileSync(join(HERE, "..", "main", "ui-bridge.js"), "utf8");

test("primeAuth warms the bearer token and swallows its failure", () => {
  const src = fnOf(BRIDGE, "primeAuth");
  // It goes through the ONE seam (never store/auth directly), so the
  // single-flight refresh and the retry ladder still own the rotation.
  assert.match(src, /getBearerToken\(\)/);
  // Fire and forget: a rejected warm-up must not become an unhandled
  // rejection, and must not gate registration.
  assert.match(src, /\.catch\(/);
  assert.ok(!/await\s+getBearerToken/.test(src), "the prime must not be awaited");
});

test("register() primes at launch, before any handler can be called", () => {
  const src = fnOf(BRIDGE, "register");
  assert.match(src, /primeAuth\(\)/, "register must run the prime");
  // Ahead of the first ipcMain.handle: registration happens in whenReady,
  // before createShellWindow, so this is the earliest the rotation can start.
  assert.ok(
    src.indexOf("primeAuth()") < src.indexOf("ipcMain.handle"),
    "the prime must run before the handlers are registered"
  );
});

test("the request path still asks for a token per call (the prime is a warm-up, not a cache)", () => {
  const src = fnOf(BRIDGE, "performApiRequest");
  // The prime must not have been "optimised" into a stored token: every
  // request re-reads the authority, which is what keeps a rotation mid-session
  // and the 401 repair correct.
  assert.match(src, /await getBearerToken\(\)/);
});
