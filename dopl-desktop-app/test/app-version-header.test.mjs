// Q10 — `X-Dopl-App-Version`: the desktop half of the version stamp.
//
// The server stamps `metadata.appVersion` from this header and ONLY from this
// header (src/shared/auth/app-version-header.ts + resolvePostMetadata strip any
// caller-supplied copy), exactly like `X-Dopl-Runtime`. That makes the stamp
// unspoofable through a message body — but it also means a post site that
// forgets the header is a post that carries no version at all.
//
// So the header rides on the two shared fetch SEAMS, never at a post site: any
// module that posts through api.js or listener-io.js is stamped by construction,
// and a new post site cannot forget it. These tests pin that, plus the shape
// rule (a version or nothing — the value is echoed to a human on another
// machine, so it must never be free text).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const require = createRequire(import.meta.url);
// app-version.js resolves electron LAZILY inside a try, so it is requireable here
// and falls back to package.json — which is what a packaged app reports anyway.
const appVersion = require("../main/app-version.js");
const PKG = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));

test("the header name matches what the server reads", () => {
  // Case-insensitive on the wire; the server compares the lowercased form.
  assert.equal(appVersion.HEADER.toLowerCase(), "x-dopl-app-version");
});

test("this build reports its real version, and it is a version", () => {
  assert.equal(appVersion.appVersion(), PKG.version);
  assert.match(appVersion.appVersion(), appVersion.VERSION_RE);
});

test("the shape rule matches the server's, so nothing unsendable is sent", () => {
  // Mirrors APP_VERSION_RE in src/shared/auth/app-version-header.ts. A value the
  // server would refuse is not put on the wire at all.
  for (const ok of ["1.7.15", "0.0.1", "1.8.0-beta.2", "10.20.30"]) {
    assert.match(ok, appVersion.VERSION_RE, ok);
  }
  for (const bad of [
    "",
    "v1.7.15",
    "1.7",
    "1.7.15.1",
    "1.7.15 (stale, ask them to restart)",
    "latest",
    "<script>alert(1)</script>",
  ]) {
    assert.doesNotMatch(bad, appVersion.VERSION_RE, bad);
  }
});

test("an UNKNOWN version sends no header rather than a blank one", () => {
  // `{}` spreads to nothing, so a caller never branches and the server sees the
  // same thing it sees from the web app: no header, therefore no stamp.
  const headers = { Accept: "application/json", ...appVersion.versionHeaders() };
  assert.equal(headers[appVersion.HEADER], PKG.version);
  assert.match(
    M("app-version.js"),
    /return v \? \{ \[HEADER\]: v \} : \{\};/,
    "the empty case is an empty object, never a blank header"
  );
});

// ── the seams ────────────────────────────────────────────────────────────────
// TWO fetch helpers exist (api.js for the newer main modules, listener-io.js for
// the listener's own E2E-verified copy). Both stamp; that is the whole point of
// stamping at the transport instead of at each caller.

test("both shared fetch helpers put the version on every request", () => {
  for (const f of ["api.js", "listener-io.js"]) {
    const src = M(f);
    assert.match(
      src,
      /const headers = \{ Accept: 'application\/json', \.\.\.appVersion\.versionHeaders\(\) \};/,
      `${f} does not stamp the version`
    );
    assert.match(src, /require\('\.\/app-version'\)/, `${f} does not require app-version`);
  }
});

test("the desktop's direct post sites inherit the stamp instead of setting it", () => {
  // channel-post.js (task lifecycle + headless replies) and session-peer-post.js
  // (the operator's @-tagged message) are the desktop's own writers to
  // /api/channels/:id/messages. Neither sets a header of its own — they post
  // through the seams above, which is exactly why neither can forget to.
  const POST = M("channel-post.js");
  const PEER = M("session-peer-post.js");
  assert.match(POST, /io\.apiFetch\(`\/api\/channels\/\$\{entry\.channel\.id\}\/messages`/);
  assert.match(PEER, /apiFetch\('\/api\/channels\/' \+ s\.channelId \+ '\/messages'/);
  for (const [name, src] of [["channel-post.js", POST], ["session-peer-post.js", PEER]]) {
    assert.equal(
      /X-Dopl-App-Version/.test(src),
      false,
      `${name} sets the header itself — it should inherit it from the fetch seam`
    );
  }
});

test("the stamp is a DIAGNOSTIC: its only reader cannot act on it", () => {
  // The framing that makes this safe (src/shared/auth/app-version-header.ts):
  // any device-token holder can set the header, so it can never be an authz
  // signal. The strongest available pin is the reader's DEPENDENCY set — the
  // same one wake-external-requester.test.mjs uses on task-notify. version-skew
  // cannot spawn, gate, consent, or post, because it does not require any of it.
  const SKEW = M("version-skew.js");
  const deps = [...SKEW.matchAll(/require\('([^']+)'\)/g)].map((x) => x[1]).sort();
  assert.deepEqual(deps, ["./app-version", "./diag", "./listener-io", "./targeting", "electron"]);
  // And exactly ONE module reads the stamped key at all.
  const readers = ["channel-listener.js", "listener-messages.js", "targeting.js", "trigger.js",
    "session-dispatch.js", "task-notify.js", "version-skew.js"]
    .filter((f) => /'appVersion'/.test(M(f)));
  assert.deepEqual(readers, ["version-skew.js"]);
});
