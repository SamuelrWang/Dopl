// THE LISTENER'S MEMBER CACHES ARE BOUNDED (main/listener-io.js).
//
// REGRESSION CONTEXT: swept out during the 17 GB dev-RSS incident, 2026-08-30. `nameCache` and
// `avatarUrlCache` were the ONLY two structures in `main/` with no cap, no TTL, no `delete`, no
// `clear` and no sweep — every member of every workspace ever enumerated stayed for the life of
// the process. They are NOT what ate the 17 GB (that was `session-narration.js`'s per-flush
// fan-out and abandoned `fetch` bodies), and they are bounded anyway: the point of a bound is
// that nobody has to re-derive "how many members could this operator possibly see" the next time
// a workspace is added.
//
// Every comparable cache in this tree already carries one — `avatar-cache.js › MAX_CACHE` (64),
// `legacy-threads.js › LEGACY_THREAD_CAP` (500 + TTL),
// `queued-notice.js › MAX_ANNOUNCED` (256), `version-skew.js › SEEN_CAP` (200),
// `agent-names.js › MAX_NAMES` (500). These two were the exception.
//
// WHY SOURCE EXTRACTION: listener-io.js is CommonJS and pulls in electron + electron-store, so
// it cannot be imported under `node --test`. `cacheMember` is dependency-free (a Map and a
// number), so it is sliced and driven verbatim — this exercises what ships.
//
// Run: `node --test dopl-desktop-app/test/listener-name-cache.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "listener-io.js"), "utf8");

const MAX = Number(/const MAX_CACHED_MEMBERS = (\d+);/.exec(SRC)?.[1]);
const cacheMember = new Function(
  `const MAX_CACHED_MEMBERS = ${MAX};\n${fnOf(SRC, "cacheMember")}\n return cacheMember;`
)();

test("the ceiling is NAMED, and both caches go through the one bounded writer", () => {
  assert.ok(Number.isInteger(MAX) && MAX > 0, "MAX_CACHED_MEMBERS must be a named integer");
  // ⚠ The pin that matters is the CALL SITE: a bare `.set()` re-introduces the unbounded
  // cache with the constant still sitting there looking like it does something.
  const refresh = fnOf(SRC, "refreshNameCache");
  assert.match(refresh, /cacheMember\(nameCache, mem\.userId, dn\)/);
  assert.match(refresh, /cacheMember\(avatarUrlCache, mem\.userId, mem\.avatarUrl\)/);
  assert.ok(
    !/\bnameCache\.set\(|\bavatarUrlCache\.set\(/.test(SRC),
    "nothing may write either cache except through cacheMember"
  );
});

test("BOUND: the cache never exceeds the ceiling, however many members are seen", () => {
  const cache = new Map();
  for (let i = 0; i < MAX * 3; i++) cacheMember(cache, `user-${i}`, `Name ${i}`);
  assert.equal(cache.size, MAX);
});

test("BOUND: eviction is OLDEST-OUT, and the newest write always survives", () => {
  const cache = new Map();
  for (let i = 0; i < MAX + 5; i++) cacheMember(cache, `user-${i}`, `Name ${i}`);
  assert.equal(cache.get("user-0"), undefined, "the first ones seen are gone");
  assert.equal(cache.get(`user-${MAX + 4}`), `Name ${MAX + 4}`, "the newest is present");
});

test("BOUND: re-seeing a member REFRESHES its position — a live workspace is never evicted", () => {
  // ⚠ THE PROPERTY THAT MAKES OLDEST-OUT CORRECT HERE. `refreshNameCache` rewrites every
  // member it sees once per reconcile (CHANNEL_REFRESH_MS), so a still-watched workspace's
  // members are continuously re-inserted while a workspace the operator LEFT never is —
  // which is what turns insertion order into "last seen" and makes the eviction pick the
  // stale rows rather than the busy ones.
  const cache = new Map();
  cacheMember(cache, "keeper", "Keeper");
  for (let i = 0; i < MAX - 1; i++) cacheMember(cache, `user-${i}`, `Name ${i}`);
  cacheMember(cache, "keeper", "Keeper v2"); // seen again on the next reconcile
  for (let i = 0; i < 10; i++) cacheMember(cache, `late-${i}`, `Late ${i}`);
  assert.equal(cache.get("keeper"), "Keeper v2", "a re-seen member outlives ones seen before it");
  assert.equal(cache.size, MAX);
});

test("BOUND: an updated value replaces rather than duplicates", () => {
  const cache = new Map();
  cacheMember(cache, "u1", "Old Name");
  cacheMember(cache, "u1", "New Name");
  assert.equal(cache.size, 1);
  assert.equal(cache.get("u1"), "New Name");
});
