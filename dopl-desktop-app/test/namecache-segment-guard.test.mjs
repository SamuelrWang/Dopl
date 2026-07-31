// THE WORKSPACE URL SEGMENT, GUARDED IN ALL THREE PLACES (2026-07-31).
//
// `{slug}-{publicId}` is the canonical workspace path segment. Two of the three
// builders already refused to compose one from a half-empty DTO:
//   channel-listener.js  reconcile      → `ws.slug && ws.publicId ? … : null`
//   channel-context.js   resolve        → the same guard
// `listener-io.refreshNameCache` interpolated blind, so a DTO with no publicId
// produced `slug-undefined`, which 404s. That request is the ONLY filler for the
// display-name AND avatar caches, so every peer in that workspace then rendered
// as "A teammate" (displayNameFor's fallback) with a lone `namecache miss 404`
// line to explain it — a cosmetic-looking symptom with a data-shape cause.
//
// This file pins the guard and the twin-parity, so a future builder cannot
// quietly reintroduce the unguarded form.
//
// Run: `node --test dopl-desktop-app/test/namecache-segment-guard.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const IO = M("listener-io.js");
const LISTENER = M("channel-listener.js");
const CONTEXT = M("channel-context.js");

// fnOf slices from the `function` keyword, so an `async function` loses its
// modifier and the body no longer parses. Re-attach it, asserting the shipped
// function really is async so this can never quietly turn a sync one async.
function asyncFnOf(src, name) {
  assert.match(src, new RegExp(`async function ${name}\\(`), `${name} must be async`);
  return `async ${fnOf(src, name)}`;
}

// The guarded prelude is what matters; the fetch below it is driven with fakes.
function loadRefresh(ws) {
  const calls = { fetched: [], logged: [] };
  const fn = new Function(
    "apiFetch", "diag", "normalizeList", "nameCache", "avatarUrlCache",
    `${asyncFnOf(IO, "refreshNameCache")}\n return refreshNameCache;`
  )(
    async (path) => {
      calls.fetched.push(path);
      return { ok: true, json: async () => ({ members: [] }) };
    },
    (...a) => calls.logged.push(a.join(" ")),
    () => [],
    new Map(),
    new Map()
  );
  return { run: () => fn(ws), calls };
}

test("a complete workspace DTO still builds the canonical segment and fetches", async () => {
  const { run, calls } = loadRefresh({ id: "ws-1", slug: "acme", publicId: "ab12cd" });
  await run();
  assert.deepEqual(calls.fetched, ["/api/workspaces/acme-ab12cd/members"]);
});

test("a DTO missing publicId fetches NOTHING — no `slug-undefined` 404", async () => {
  for (const ws of [
    { id: "ws-1", slug: "acme" },
    { id: "ws-1", slug: "acme", publicId: null },
    { id: "ws-1", slug: "acme", publicId: "" },
  ]) {
    const { run, calls } = loadRefresh(ws);
    await run();
    assert.deepEqual(calls.fetched, [], JSON.stringify(ws));
    assert.match(calls.logged.join("\n"), /namecache skip/, "and it says why, naming the workspace");
  }
});

test("a DTO missing slug is refused the same way, and so is no DTO at all", async () => {
  for (const ws of [{ id: "ws-1", publicId: "ab12cd" }, null, undefined]) {
    const { run, calls } = loadRefresh(ws);
    await run();
    assert.deepEqual(calls.fetched, []);
  }
});

test("the guard matches its twins — one shape for the segment across the listener", () => {
  // If these ever diverge again, the odd one out is the bug.
  const guard = /ws\.slug && ws\.publicId \? `\$\{ws\.slug\}-\$\{ws\.publicId\}` : null/;
  assert.match(fnOf(IO, "refreshNameCache"), guard, "listener-io (the one that was missing it)");
  assert.match(LISTENER, guard, "channel-listener reconcile");
  assert.match(CONTEXT, guard, "channel-context resolve");
  assert.ok(
    !/`\$\{ws\.slug\}-\$\{ws\.publicId\}`/.test(
      fnOf(IO, "refreshNameCache").replace(guard, "")
    ),
    "no second, unguarded interpolation survives in listener-io"
  );
});
