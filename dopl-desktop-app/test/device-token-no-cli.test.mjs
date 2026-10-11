// A MAC WITH NO EXTERNAL CLAUDE CODE CLI GETS A DEVICE TOKEN, AND A MUTE LAUNCH IS REFUSED
// BEFORE IT IS REPORTED STARTED (2026-10-10).
//
// THE DEFECT, measured in the shipped source. `mcp-config.js › ensureMcpConfigInner` ran
// `spawner.getClaudeBinPath()` BEFORE `obtainDeviceToken()` and returned
// `skip (claude cli unresolved)` when it answered null. That probe is EXTERNAL-ONLY
// (`claude-resolve.js › probeStaticPath`: ~/.local/bin, /opt/homebrew/bin, /usr/local/bin,
// ~/.npm-global/bin, ~/node_modules/.bin, plus a login-shell `command -v claude`; its
// electron-store `claudeBinPath` override has NO WRITER anywhere in main/), so the
// asar-unpacked binary a session actually runs cannot satisfy it. `saveDeviceToken` has exactly
// one caller and `obtainDeviceToken` exactly one, so there was no second minting path:
//
//   no external CLI  ->  no device token, ever
//                    ->  `loader.js › buildMcpServers` returns {} (no bearer)
//                    ->  the child's init reports no `dopl` server
//                    ->  `mcp-connect.js › doplStatus` reads `missing`
//                    ->  `mcp-connect-guard.js` ends the session `mcp-unreachable`
//
// ...one retry later, and AFTER `session-launch-op.js` answered the clicking human
// `{ ok: true, agentId }`. Most people this app is distributed to have no external CLI.
//
// THE FIX, in two halves, both pinned here:
//   • MINTING DEPENDS ON THE DOPL SIGN-IN ALONE (`mcp-config.js › ensureDeviceToken`), and the
//     external probe gates only the operator's own user-scope `claude mcp` entry — the one part
//     that genuinely needs a binary. This is the split `claude-runtime.js:15-33` already made
//     between `claudeAvailable()` and `sessionSpawnAvailable()`, applied to the mint.
//   • A LAUNCH WITH NO BEARER IS REFUSED BEFORE `startSession` (`delivery-path.js`, called from
//     `session-launch.js`), so the human sees a failure instead of a success and then silence.
//
// The ORDER half of the first bullet lives in `mcp-entry-origin.test.mjs` (which drives the real
// `ensureMcpConfigInner` over fakes, and whose `bin:"" -> []` assertion WAS this bug written
// down). This file pins what that one cannot reach: the pre-flight's own decisions, the builder's
// behaviour with and without a bearer, and that the funnel asks before it registers.
//
// METHOD is the directory idiom: `main/` is electron-bound, so modules are source-extracted or
// loaded over a stub map. §6 drives the REAL mcp-config.js + mcp-device-token-lifecycle.js
// (`_device-token-harness.mjs`); `session-launch.js` and the loader are still sliced (other sectors).
//
// Run: `node --test dopl-desktop-app/test/device-token-no-cli.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf, orderOf } from "./helpers/source-probe.mjs";
import { loadWithStubs } from "./helpers/module-sandbox.mjs";
import { deviceTokenWorld, minted } from "./_device-token-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const LAUNCH = M("session-launch.js");
const LOADER = M("runtime/claude/loader.js");

// ── the pre-flight, real, over a faked credential layer ──────────────────────
// `delivery-path.js` requires `./mcp-config`, `./auth` and `./diag` LAZILY (inside its functions),
// so the stub map answers them at call time — which is also why an unloadable mcp-config is a
// real case rather than a theoretical one.
function bootPath(opts) {
  const o = opts || {};
  const calls = [];
  return {
    calls,
    mod: loadWithStubs("delivery-path.js", {
      "./diag": { diag: () => {} },
      "./mcp-config": {
        deviceTokenForSpawn: () => {
          calls.push("cached");
          if (o.cachedThrows) throw new Error("safeStorage unavailable");
          return o.cached === undefined ? "" : o.cached;
        },
        ensureDeviceToken: async () => {
          calls.push("mint");
          return o.minted === undefined ? "" : o.minted;
        },
      },
      "./auth": {
        ensureSignedIn: async () => {
          calls.push("signedIn");
          if (o.authThrows) throw new Error("jar unreadable");
          return o.signedIn !== false;
        },
      },
    }),
  };
}

// ── 1. THE REGRESSION: A CLI-LESS MAC HAS A DELIVERY PATH ────────────────────

test("a token minted with no external CLI is a delivery path — the launch proceeds", async () => {
  // The whole point of the fix: `getClaudeBinPath` is not consulted ANYWHERE on this path. There
  // is no `spawner` in the stub map, so a probe sneaking back in would throw `unexpected require`.
  const { mod, calls } = bootPath({ cached: "", minted: "tok-from-signin" });
  assert.equal(await mod.deliveryBlockedReason(), "", "a minted token is a delivery path");
  assert.deepEqual(calls, ["cached", "mint"], "cached first, then the mint — and no CLI probe");
  assert.equal(mod.muteRefusal(""), null, "and nothing refuses the launch");
});

test("the healthy machine awaits NOTHING on the click path", async () => {
  // A cached bearer is a sync electron-store read, and this is a human's click. If the mint ever
  // runs when there is already a token to spend, every New Agent press pays a network round trip.
  const { mod, calls } = bootPath({ cached: "tok-cached" });
  assert.equal(await mod.deliveryBlockedReason(), "");
  assert.deepEqual(calls, ["cached"], "no mint, no sign-in probe");
});

// ── 2. THE VISIBLE REFUSAL (the second half of the fix) ──────────────────────

test("no token and signed in is `mint-failed`, and it refuses the launch", async () => {
  const { mod, calls } = bootPath({ cached: "", minted: "", signedIn: true });
  const reason = await mod.deliveryBlockedReason();
  assert.equal(reason, "mint-failed");
  assert.deepEqual(calls, ["cached", "mint", "signedIn"], "the discriminator runs only after the mint failed");
  const refusal = mod.muteRefusal(reason);
  assert.equal(refusal.skipped, "disabled", "an EXISTING wire word — the refusal set is closed");
  assert.match(refusal.detail, /credential/i, "and `detail` says what actually happened");
});

test("signed out is its OWN reason, and also refuses", async () => {
  // Spec's "signed-out still skips": the mint is gated on the sign-in inside `ensureDeviceToken`,
  // so it answers '' here too — the two must still be distinguishable, because one of them is
  // fixed by signing in and the other is not.
  const { mod } = bootPath({ cached: "", minted: "", signedIn: false });
  const reason = await mod.deliveryBlockedReason();
  assert.equal(reason, "signed-out");
  assert.equal(mod.muteRefusal(reason).skipped, "disabled");
  assert.match(mod.muteRefusal(reason).detail, /sign/i);
});

test("an unreadable sign-in state still refuses, never silently launches a mute agent", async () => {
  const { mod } = bootPath({ cached: "", minted: "", authThrows: true });
  assert.equal(await mod.deliveryBlockedReason(), "mint-failed",
    "we KNOW there is no token; only WHY is unknown");
});

// ── 3. A FAILED PROBE IS NOT A NO ────────────────────────────────────────────

test("a credential layer that THROWS fails OPEN — the launch is not refused on a probe miss", async () => {
  // `session-launch.js › credentialMissing` has the same rule in as many words. This file may
  // refuse only on a fact it read; under `node --test` mcp-config cannot even load.
  const { mod } = bootPath({ cachedThrows: true });
  assert.equal(await mod.deliveryBlockedReason(), "");
});

test("an unknown reason word is never a refusal", async () => {
  const { mod } = bootPath({ cached: "t" });
  for (const word of ["", null, undefined, "busy", "no-sdk", "toString", "__proto__"]) {
    assert.equal(mod.muteRefusal(word), null, `${String(word)} must not refuse`);
  }
});

// ── 4. WHAT THE TOKEN BUYS: THE `dopl` ENTRY ITSELF ──────────────────────────
// The real builder, so this pins the actual consequence the defect had rather than a restatement.

const MCP_URL = "https://dopl.test/api/mcp";
const buildServers = (token) =>
  new Function(
    "doplBearer", "clientTimeoutMs", "MCP_URL", "policy", "workspaceId",
    `${fnOf(LOADER, "buildMcpServers")}\n return buildMcpServers(policy, workspaceId);`
  )(() => token, () => 280_000, MCP_URL, null, "");

test("a bearer builds the `dopl` server; no bearer builds NOTHING", () => {
  const withToken = buildServers("tok-abc");
  assert.deepEqual(Object.keys(withToken), ["dopl"], "the session's only delivery path");
  assert.equal(withToken.dopl.headers.Authorization, "Bearer tok-abc");
  assert.equal(withToken.dopl.url, MCP_URL);
  // ⚠ THE DEFECT'S ACTUAL OUTPUT. Not an error, not a retry — an empty object, which is why a
  // mute agent launched happily and only the init message ever noticed.
  assert.deepEqual(buildServers(""), {}, "no bearer => no dopl server at all");
});

// ── 5. THE FUNNEL ASKS BEFORE IT REGISTERS ───────────────────────────────────

test("`launch` refuses on the pre-flight BEFORE `startSession`", () => {
  // Order, not presence: after `startSession` the session is registered and a refusal would need
  // the rollback `session-engine.js` does for an auth hold. Before it, there is nothing to undo.
  const fn = "async " + fnOf(LAUNCH, "launch");
  assert.match(fn, /deliveryPath\.muteRefusal\(await deliveryPath\.deliveryBlockedReason\(\)\)/,
    "the funnel asks the question");
  assert.ok(
    orderOf(fn, "deliveryPath.muteRefusal(", "deps.startSession("),
    "and it asks before anything is registered"
  );
});

test("the pre-flight returns the refusal AS GIVEN — no second opinion in the funnel", () => {
  // `delivery-path.js` owns the word and the sentence. A funnel that rewrote either would be a
  // second place to keep the closed refusal set honest.
  const fn = "async " + fnOf(LAUNCH, "launch");
  assert.match(fn, /return muteRefusal;/);
  assert.ok(!/skipped: 'disabled', detail/.test(fn), "the funnel does not restate the shape");
});

// ── 6. THE MINT'S OWN ORDER, DRIVEN ──────────────────────────────────────────
// The real modules over fakes; `calls.seq` is every seam in the order it was hit
// (signedIn, fetch:POST = the mint, rm = spawn-file shed, skills, bin = the external-CLI probe, …).

const mintOk = () => minted({ token: "tok-new", expiresAt: Date.now() + 90 * 86400e3 });

test("`ensureMcpConfigInner` mints BEFORE it looks for an external CLI", async () => {
  const world = deviceTokenWorld({ bin: "", fetch: mintOk() });
  await world.config.ensureMcpConfig();
  const seq = world.calls.seq;
  const at = (step) => {
    const i = seq.indexOf(step);
    assert.notEqual(i, -1, `${step} must run (seq: ${seq.join(",")})`);
    return i;
  };
  assert.ok(at("fetch:POST") < at("bin"), "the token may never again wait on a binary");
  // The three things that need no binary all sit above the probe (the skill-install comment has
  // claimed this since 2026-09-03; until 2026-10-10 it was false).
  for (const step of ["rm", "skills"]) {
    assert.ok(at(step) < at("bin"), `${step} must not need a CLI`);
  }
  assert.equal(world.config.deviceTokenForSpawn(), "tok-new", "and the session path has its bearer");
});

test("the mint is gated on the SIGN-IN and on nothing else", async () => {
  // ⚠ ORDER, NOT PRESENCE (release review 2026-10-11): a mint above the gate hands a signed-out
  // machine a bearer and revokes the previous one doing it (`obtainDeviceToken` is
  // revoke-and-replace), so what is asserted is that NO mint request leaves a signed-out machine.
  const out = deviceTokenWorld({ signedIn: false, fetch: () => { throw new Error("minted while signed out"); } });
  assert.equal(await out.lifecycle.ensureDeviceToken(), "", "signed out answers ''");
  assert.deepEqual(out.calls.seq, ["signedIn"], "a gate that does not return is not a gate");
  const thrown = deviceTokenWorld({ signedIn: () => { throw new Error("jar unreadable"); }, fetch: mintOk() });
  assert.equal(await thrown.lifecycle.ensureDeviceToken(), "", "an unreadable sign-in never mints");
  assert.deepEqual(thrown.calls.fetches, []);
  // Signed in: the gate, then the one mint — and no CLI probe anywhere on this path. The world's
  // `bin` seam records every getClaudeBinPath call, so a probe sneaking back in is visible.
  const ok = deviceTokenWorld({ bin: "", fetch: mintOk() });
  assert.equal(await ok.lifecycle.ensureDeviceToken(), "tok-new");
  assert.deepEqual(ok.calls.seq, ["signedIn", "fetch:POST"],
    "no CLI probe may reach the minting path again — that IS the defect");
});

test("the mint is single-flight, so a click and startup cannot mint twice", async () => {
  // Two mints revoke each other server-side (`obtainDeviceToken` is revoke-and-replace), which
  // would leave the operator's CLI entry carrying a dead bearer.
  const world = deviceTokenWorld({ fetch: mintOk() });
  const a = world.lifecycle.ensureDeviceToken();
  const b = world.config.ensureDeviceToken(); // the pre-flight's name for the same function
  assert.equal(a, b, "the second caller joins the first flight");
  assert.deepEqual([await a, await b], ["tok-new", "tok-new"]);
  assert.equal(world.calls.fetches.length, 1, "ONE mint request");
  // …and the flight is released: the next call runs its own gate (and reuses the cached token).
  assert.equal(await world.lifecycle.ensureDeviceToken(), "tok-new");
  assert.equal(world.calls.signedIn, 2, "a settled flight does not answer forever");
  assert.equal(world.calls.fetches.length, 1, "inside the reuse margin nothing is re-minted");
});
