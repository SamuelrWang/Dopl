#!/usr/bin/env node
/**
 * A PRELOAD BRIDGE WITH NO CALLER IS A CAPABILITY NOBODY CAN REACH.
 *
 * ⚠ **THIS SCRIPT EXISTS BECAUSE THAT SHIPPED AND RAN FOR FIFTEEN DAYS.**
 * `renderer/app-preload.js` exposed `dopl.orchestratorDirect` on 2026-08-31 with its
 * store key, its `appWindowOnly` IPC pair and its `SpaBridgeSurface` type all in
 * place — and nothing in the SPA ever called it. So `orchestratorDirectEnabled` was
 * never written, `main/orchestrator-consent.js › getOrchestratorDirect` answered
 * `false` forever, and **38 of 38 private directions filed between 2026-08-31 and
 * 2026-09-15 expired unclaimed**, each one reporting `pending, claimed=no` and naming
 * no cause. Full trace: `DIRECTION-DROP-TRACE.md`.
 *
 * Every layer was individually correct and individually tested. `test/_ipc-ops-table.mjs`
 * asserted both IPC ops existed; `test/preload-parity.test.mjs` asserted the preload
 * matched. **No test asked whether anything CALLED it**, because each test owned one
 * layer and the gap was between two of them. That is the shape this check closes.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────────
 * Reads the bridge members `app-preload.js` puts on `window.dopl`, then requires each
 * one to be named somewhere outside the preload itself. A member nobody names is a
 * dead grant and fails the build.
 *
 * ⚠ **IT MATCHES ON THE MEMBER NAME, NOT ON A CALL EXPRESSION**, deliberately. Callers
 * reach these through feature detection (`window.dopl?.orchestratorDirect`), through a
 * hook that casts, or through the `apps/desktop-ui` mirror; a checker that insisted on
 * `.get(` would go red on correct code and teach people to suppress it. Naming the
 * member is the weakest honest signal that somebody meant to use it.
 *
 * ⚠ **IT CANNOT PROVE THE CALLER IS REACHABLE**, and does not claim to: a hook that
 * exists but is never mounted still passes. It catches the total absence that actually
 * happened, which is the failure worth a build break.
 *
 * Usage: `node scripts/check-bridge-caller-drift.mjs` (exit 1 on drift).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PRELOAD = join(ROOT, "dopl-desktop-app/renderer/app-preload.js");

/** Where a caller may legitimately live. */
const SEARCH_ROOTS = ["src", "apps/desktop-ui/src"];
const SEARCH_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

/**
 * ⚠ **DECLARATION FILES ARE NOT CALLERS, AND EXCLUDING THEM IS THE DIFFERENCE BETWEEN
 * THIS CHECK WORKING AND THIS CHECK BEING THEATRE.**
 *
 * `spa-bridge.ts` and its `apps/desktop-ui` mirror declare the SHAPE of every member
 * on `window.dopl`. They therefore NAME every member by construction — including the
 * orphan this script exists to catch. Counting them as callers makes the check pass on
 * exactly the bug it was written for: `orchestratorDirect` was declared in
 * `spa-bridge.ts:97` for the whole fifteen days it had no control.
 *
 * ⚠ THIS WAS CAUGHT BY RUNNING THE CHECK AGAINST THE PRE-FIX TREE INSTEAD OF TRUSTING
 * IT GREEN, and it is the same defect class as the auto-address regression tests whose
 * fixture type forbade the field they needed to see. A guard that cannot fail is worse
 * than no guard: it converts an open question into a false assurance.
 */
const NOT_A_CALLER = [
  "src/shared/lib/spa-bridge.ts",
  "apps/desktop-ui/src/lib/dopl-bridge.ts",
];

/**
 * ⚠ MEMBERS THAT ARE ALLOWED TO HAVE NO SPA CALLER, each with the reason it is not a
 * dead grant. Keep this list SHORT and never add to it to silence a real gap: the
 * whole value of the check is that an unreachable capability cannot be quietly
 * normalised. An entry here is a claim that something OTHER than the SPA consumes it.
 */
const EXEMPT = new Map([
  // (none today — every member currently has a caller. The map exists so that a
  // deliberate exemption is a reviewed line rather than a deleted check.)
]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (SEARCH_EXT.has(full.slice(full.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

/**
 * The bridge members the preload puts on `window.dopl`.
 *
 * ⚠ TOP-LEVEL KEYS ONLY, read off the object literal's own indentation (two spaces),
 * so a nested key like `orchestratorDirect.get` is not mistaken for a member. Comment
 * lines and strings cannot match: the pattern requires a bare identifier followed by a
 * colon at exactly that depth.
 */
function preloadMembers(source) {
  const found = new Set();
  for (const line of source.split("\n")) {
    const m = /^ {2}([A-Za-z_$][\w$]*)\s*:/.exec(line);
    if (m) found.add(m[1]);
  }
  return [...found];
}

const preloadSource = readFileSync(PRELOAD, "utf8");
const members = preloadMembers(preloadSource);

if (members.length === 0) {
  console.error(
    "check-bridge-caller-drift: parsed ZERO members out of app-preload.js.\n" +
      "That is a broken checker, not a clean bill of health — the preload's object shape\n" +
      "probably changed. Fix the parser before trusting this script again."
  );
  process.exit(1);
}

const declarationFiles = NOT_A_CALLER.map((p) => join(ROOT, p));
const files = SEARCH_ROOTS.flatMap((r) => walk(join(ROOT, r))).filter(
  (f) => !declarationFiles.includes(f)
);
const haystack = files.map((f) => readFileSync(f, "utf8")).join("\n");

const orphans = members.filter((m) => !EXEMPT.has(m) && !haystack.includes(m));

if (orphans.length > 0) {
  console.error(
    "\ncheck-bridge-caller-drift: BRIDGE MEMBER WITH NO CALLER\n\n" +
      orphans.map((m) => `  dopl.${m}  — exposed by the preload, named by nothing in the SPA`).join("\n") +
      "\n\nA preload member nobody calls is a capability the operator cannot reach. This is\n" +
      "exactly how `orchestratorDirect` shipped dead on 2026-08-31 and dropped 38 private\n" +
      "directions in silence (DIRECTION-DROP-TRACE.md).\n\n" +
      "Fix it by building the control, not by exempting it. If something outside the SPA\n" +
      "really does consume this member, add it to EXEMPT with the reason.\n"
  );
  process.exit(1);
}

console.log(
  `check-bridge-caller-drift: ok — ${members.length} bridge members, every one named by a caller.`
);
