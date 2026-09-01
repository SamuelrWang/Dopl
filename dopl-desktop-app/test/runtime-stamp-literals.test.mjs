// WHERE THE `X-Dopl-Runtime` STAMPS LEAVE FROM, AND THAT THEIR LITERALS MATCH THE SERVER'S.
//
// The desktop produces two runtime stamps and the server reads both:
//   `desktop-ui`      the operator TYPING in the bundled SPA — attached in `main/ui-bridge.js`,
//                     the ONE transport that renderer has (its preload exposes no header
//                     surface and every handler is bound to that window's own top frame), so
//                     the stamp cannot ride a request the renderer did not originate and a new
//                     call site cannot forget it.
//   `desktop-session` a session the app SPAWNED — `main/sdk-loader.js`, and ONLY that file as
//                     of S3 (2026-08-26). `main/mcp-config.js` used to carry the literal too,
//                     for the headless `--mcp-config` spawn path; that path's executor died on
//                     2026-08-20 and its credential file was deleted by
//                     `mcp-config.js › removeSpawnConfig`. Pinned as a literal by
//                     `test/sdk-grant.test.mjs`, which is the sibling this file was written to
//                     match.
//   ⚠ THE CLI ENTRY IS DELIBERATELY UNSTAMPED. `mcp-cli-add.js › addMcpEntry` sends
//   `Authorization` and nothing else, and it never sent the runtime header — a manual `claude`
//   run in the operator's own terminal is NOT a session this app spawned, and claiming
//   `desktop-session` for it would be the exact confusion the stamp exists to remove.
//
// F-145 — WHY THIS FILE EXISTS. These pins lived in `test/operator-typed-request.test.mjs`,
// whose subject is the requester-open PREDICATE's truth table, and that file sat at EXACTLY
// 500 lines (the §2 cap) doing two jobs. Worse, the `desktop-ui` pin asserted only the
// SYMBOLIC form — `/\[RUNTIME_HEADER\]: DESKTOP_UI_RUNTIME,/` — so rewriting either constant's
// VALUE kept it green while the whole Phase-1 stamp stopped matching the server. There is no
// shared module across this join (main is CommonJS Electron; the reader is
// `src/shared/auth/runtime-header.ts`), so the two sides agree by LITERAL or not at all, and
// the failure is silent in the way F-140 describes: no stamp means no requester window, which
// reads as a feature that never worked.
//
// So the subject here is the JOIN, both directions, for both stamps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const UI_BRIDGE = M("ui-bridge.js");
// The web tree's own source, so a change made from EITHER side fails this file.
const SHARED = readFileSync(
  join(HERE, "..", "..", "src", "shared", "auth", "runtime-header.ts"),
  "utf8"
);

test("main attaches X-Dopl-Runtime: desktop-ui to the SPA renderer's transport", () => {
  // BOTH LITERALS, not the symbols they are spelled with.
  assert.match(UI_BRIDGE, /const RUNTIME_HEADER = 'X-Dopl-Runtime';/,
    "the header NAME the server matches, as a literal");
  assert.match(UI_BRIDGE, /const DESKTOP_UI_RUNTIME = 'desktop-ui';/,
    "the header VALUE narrowRuntime recognizes, as a literal");
  assert.match(UI_BRIDGE, /\[RUNTIME_HEADER\]: DESKTOP_UI_RUNTIME,/);
  const builder = UI_BRIDGE.indexOf("async function sendApiRequest(");
  const stamp = UI_BRIDGE.indexOf("[RUNTIME_HEADER]: DESKTOP_UI_RUNTIME");
  assert.ok(builder !== -1 && stamp > builder, "the stamp rides sendApiRequest's header block");
});

test("…and those two literals are the ones the SERVER reads (the join has no shared module)", () => {
  // Header names are case-insensitive on the wire and the server stores its constant
  // lower-cased (`Headers.get` folds), which is the one difference this comparison allows.
  const serverHeader = /export const RUNTIME_HEADER = "([^"]+)";/.exec(SHARED);
  const serverValue = /export const DESKTOP_UI_RUNTIME = "([^"]+)";/.exec(SHARED);
  assert.ok(serverHeader && serverValue, "the server's constants moved — this join needs re-pinning");
  const mainHeader = /const RUNTIME_HEADER = '([^']+)';/.exec(UI_BRIDGE);
  const mainValue = /const DESKTOP_UI_RUNTIME = '([^']+)';/.exec(UI_BRIDGE);
  assert.equal(mainHeader[1].toLowerCase(), serverHeader[1].toLowerCase(),
    "main sends a header name the server does not read");
  assert.equal(mainValue[1], serverValue[1],
    "main claims a runtime value narrowRuntime does not recognize — every stamp would be dropped");
});

test("the SESSION stamp's literal matches the server's too, on the one spawn path left", () => {
  // `sdk-grant.test.mjs` already pins the SDK path's literal; what it cannot see is whether the
  // server still recognizes that string.
  const serverSession = /export const DESKTOP_SESSION_RUNTIME = "([^"]+)";/.exec(SHARED);
  assert.ok(serverSession, "the server's constant moved — this join needs re-pinning");
  for (const file of ["runtime/claude/loader.js"]) {
    const src = M(file);
    const hit = /'X-Dopl-Runtime': '([^']+)',/.exec(src);
    assert.ok(hit, `${file} no longer sends the runtime header at all`);
    assert.equal(hit[1], serverSession[1],
      `${file} claims a runtime value narrowRuntime does not recognize`);
  }
});

// ⚠ THE SECOND DIMENSION (2026-08-31, runtime-adapter port step 1). Vendor is NOT a value of the
// custody enum above, and this file is where that stays true across a join with no shared module:
// `main/targeting.js › DESKTOP_RUNTIMES`, `packages/mcp-server/src/tools/identity.ts ›
// runtimeWord` and `channel-wake-guidance.ts` all read the CUSTODY word by strict equality or
// membership, so a vendor word admitted there would flip every non-Claude session out of the
// desktop branch with nothing failing.
test("the VENDOR stamp is a SECOND header, and its literal matches the server's", () => {
  const serverVendorHeader = /export const VENDOR_HEADER = "([^"]+)";/.exec(SHARED);
  const serverClaude = /export const CLAUDE_VENDOR = "([^"]+)";/.exec(SHARED);
  assert.ok(serverVendorHeader && serverClaude,
    "the server's vendor constants moved — this join needs re-pinning");
  const src = M("runtime/claude/loader.js");
  const hit = /'X-Dopl-Vendor': '([^']+)',/.exec(src);
  assert.ok(hit, "sdk-loader.js no longer sends the vendor header at all");
  assert.equal(hit[1], serverClaude[1],
    "sdk-loader claims a vendor value readVendorHeader does not recognize");
  assert.equal("X-Dopl-Vendor".toLowerCase(), serverVendorHeader[1].toLowerCase(),
    "main sends a vendor header name the server does not read");
});

test("...and the CUSTODY enum did NOT grow a vendor word", () => {
  // The whole reason step 1 is a second dimension rather than three more enum members. Asserted
  // on BOTH sides of the join: the server's recognized set, and the membership test in main.
  const serverRuntimes = /const RECOGNIZED: readonly string\[\] = \[([\s\S]*?)\];/.exec(SHARED);
  assert.ok(serverRuntimes, "the server's recognized-runtime list moved — re-pin this");
  for (const vendor of ["claude", "codex", "cursor"]) {
    assert.ok(!serverRuntimes[1].includes(vendor),
      `'${vendor}' is a VENDOR and must never be a recognized RUNTIME value`);
  }
  const targeting = M("targeting.js");
  const list = /const DESKTOP_RUNTIMES = \[([^\]]*)\];/.exec(targeting);
  assert.ok(list, "DESKTOP_RUNTIMES moved — re-pin this");
  assert.equal(list[1].replace(/\s/g, ""), "'desktop-session','desktop-ui'",
    "DESKTOP_RUNTIMES is an array MEMBERSHIP test: a vendor word added here does not widen the "
    + "set, it drops every non-Claude session out of it");
});

test("the CLI-entry lane sends NO runtime stamp, and that is the intended state", () => {
  // Stated as an assertion rather than left as an absence someone 'fixes'. If a future round
  // decides a manual `claude` run should be stamped, that is a product decision about what
  // `desktop-session` MEANS — not a missing header to paste in.
  const cliAdd = M("mcp-cli-add.js");
  assert.ok(!/X-Dopl-Runtime/.test(cliAdd), "addMcpEntry stamps nothing");
  assert.match(cliAdd, /'--header', `Authorization: Bearer \$\{token\}`,/, "…just the bearer");
  assert.ok(!/X-Dopl-Runtime/.test(M("mcp-config.js")),
    "and mcp-config holds no runtime literal now that the spawn-config file is gone");
});

test("the LISTENER and SESSION-POST lanes are deliberately NOT stamped desktop-ui", () => {
  // main/api.js (consent, presence, session posts) and listener-io.js (the long poll and the
  // channel posts a session makes) carry other people's posts, not the operator typing. A stamp
  // there would make a session's own reply look like a person, which is the confusion the whole
  // Phase-1 change removes.
  for (const file of ["api.js", "listener-io.js", "channel-post.js"]) {
    assert.ok(!M(file).includes("desktop-ui"), `${file} must not claim the UI runtime`);
  }
});
