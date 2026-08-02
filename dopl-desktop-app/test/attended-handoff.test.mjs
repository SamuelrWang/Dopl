// F-118 — THE ATTENDED HANDOFF: the deep link, the fallback ladder, and what it does NOT do.
//
// THE FEATURE. A peer's consent card gains "Open in Claude Code", which hands the request to
// the operator's OWN Claude Code with a prefilled, unsubmitted prompt instead of letting Dopl
// spawn a session. main/attended-handoff.js builds the URL, decides the rung, and acts.
//
// WHAT THIS FILE IS GUARDING, in order of how badly it would hurt:
//
//   1. THE URL IS BUILT WITH encodeURIComponent AND NOTHING ELSE. This deep link had a real
//      RCE (flag smuggling through `q`, fixed in CLI 2.1.118). Prompt text must never reach a
//      shell, and must never be able to grow a second URL parameter.
//   2. IT RESOLVES NOTHING. No spawn, no consent-row patch, no watcher poke, no lifecycle
//      post, nothing fed to any session. The consent row stays PENDING so Accept still works.
//      Pinned as the module's DEPENDENCY SET (the idiom test/wake-external-requester.test.mjs
//      uses for the passive notify lane) plus a source scan of the one IPC handler.
//   3. THE LADDER FAILS TO THE CLIPBOARD. No handler bundle, an over-cap URL, an
//      unencodable prompt, or an openExternal that rejects: all four copy and notify rather
//      than opening nothing and saying nothing.
//   4. THE CAP IS ON THE URL, NOT ON `q` (the 2026-08-02 live bug). The docs cap `q` at
//      5,000 characters; the handler silently drops any URL over 4,096 TOTAL, scheme and cwd
//      included. The first release routed on `q` alone, built a 4,128-character URL, and the
//      operator's click opened nothing at all: openExternal resolved, LaunchServices
//      accepted, no window appeared and no error surfaced anywhere. openExternal CANNOT
//      detect this, so the pre-flight length check is the only guard and the URL must
//      therefore be built BEFORE the route is chosen. That ordering is pinned below.
//
// METHOD: attended-handoff.js is electron-bound (shell / clipboard / Notification), so the
// functions under test are brace-matched out of the source and evaluated with fakes — the
// idiom this directory uses (sdk-grant / sdk-mcp-token / session-id-stamp).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf, between } from "./helpers/source-probe.mjs";
// Fixtures and the source-extracted harness are shared with test/attended-app-route.test.mjs,
// which drives the SAME open() over the app rung. One harness, so it cannot drift.
import { CH, WS, TH, CARD, handoffHarness as harness } from "./helpers/attended.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SRC = M("attended-handoff.js");
const IPC = M("session-ipc.js");
const CONSENT = M("session-consent.js");
const PRELOAD = readFileSync(join(HERE, "..", "renderer", "session", "session-preload.js"), "utf8");

const { buildAttendedPrompt } = require("../main/attended-prompt.js");

const PROMPT = buildAttendedPrompt({ channelId: CH, workspaceId: WS, threadId: TH });

// ── The pure block, sliced and evaluated verbatim ─────────────────────────────
// The BEGIN/END sentinels carry no electron / fs / os refs, so this is the shipped code.

// Full-line comments dropped. These modules EXPLAIN the clipboard rung, encodeURIComponent
// and the handoff by name, so a raw grep for any of them reads a comment as readily as a
// call — the failure mode source-probe.js was written to close one layer down.
const codeOnly = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const BLOCK = between(SRC, "// ─── BEGIN ATTENDED-HANDOFF-PURE", "// ─── END ATTENDED-HANDOFF-PURE", "attended-handoff");
const pure = new Function(`${BLOCK}\n return { encodeQ, handoffUrl, handlerAppPaths, chooseRoute, SCHEME, URL_MAX_CHARS, HANDLER_APP };`)();
const { encodeQ, handoffUrl, handlerAppPaths, chooseRoute, URL_MAX_CHARS } = pure;

test("the pure block really is pure (nothing electron-bound, nothing on disk)", () => {
  const code = codeOnly(BLOCK);
  // The API SURFACES, not the words: 'clipboard' is also the name of a route this block
  // RETURNS, and a route name is a value rather than a reference to electron.
  for (const forbidden of [/require\(/, /\bshell\./, /\bclipboard\./, /Notification/, /\bfs\./, /\bos\./, /channelDirs/, /diag\(/]) {
    assert.doesNotMatch(code, forbidden, `the sliced block references ${forbidden}`);
  }
});

// ── 1. THE URL ────────────────────────────────────────────────────────────────

test("the URL is the documented scheme with exactly two parameters, cwd then q", () => {
  const url = handoffUrl("/Users/sam/Downloads", "hello");
  assert.equal(url, "claude-cli://open?cwd=%2FUsers%2Fsam%2FDownloads&q=hello");
  assert.equal(pure.SCHEME, "claude-cli://open");
  // `repo=` exists on this scheme and is deliberately unused: it resolves against the user's
  // githubRepoPaths rather than against a path we know.
  assert.ok(!/[?&]repo=/.test(url), "no repo parameter");
  assert.ok(!/[?&]repo=/.test(SRC), "...and the module never learns to send one");
});

test("every character that could grow a second parameter is percent-encoded", () => {
  // The RCE this scheme actually had was flag smuggling through `q`. The narrow property
  // here: nothing in the prompt can terminate the value and start a new key.
  const hostile = 'a b\nc"d\'e&f=g?h#i%j/k\\l`m$n;o|p<q>r{s}t';
  const url = handoffUrl("/tmp", hostile);
  const q = url.slice(url.indexOf("&q=") + 3);
  assert.equal(q, encodeURIComponent(hostile), "encodeURIComponent, character for character");
  assert.equal(url.split("?").length - 1, 1, "one query string");
  assert.equal(url.split("&").length - 1, 1, "one separator, so `q` is the last parameter and stays whole");
  assert.equal(decodeURIComponent(q), hostile, "and it round-trips exactly");
  for (const ch of [" ", "\n", '"', "&", "=", "?", "#", "`", "$", ";", "|", "\\"]) {
    assert.ok(!q.includes(ch), `${JSON.stringify(ch)} reached the URL raw`);
  }
  assert.ok(q.includes("%20") && q.includes("%0A") && q.includes("%22"), "spaces, newlines and quotes are escaped");
});

test("encodeURIComponent is the ONLY encoder, and no prompt text ever touches a shell", () => {
  // A hand-rolled escape is how this class of bug comes back.
  const code = codeOnly(SRC);
  assert.equal(code.split("encodeURIComponent").length - 1, 1, "one call site, inside encodeQ");
  assert.match(fnOf(SRC, "encodeQ"), /encodeURIComponent/);
  assert.ok(!/escape\(|encodeURI\(|querystring|URLSearchParams/.test(code), "no second encoder");
  for (const shell of [/child_process/, /execSync|execFile|spawnSync|\bspawn\(/, /osascript/, /\/bin\/sh/]) {
    assert.doesNotMatch(code, shell, `the module reaches a shell: ${shell}`);
  }
  // shell.openExternal is a URL handoff to the OS, not a command line. It is called with ONE
  // argument, the built URL, and nothing else.
  assert.match(SRC, /await shell\.openExternal\(url\);/);
});

test("an unencodable prompt yields NO url at all, rather than a half-formed one", () => {
  // encodeURIComponent THROWS URIError on an unpaired surrogate. A throw out of a button
  // click is not an option, so encodeQ answers null and the caller routes to the clipboard.
  assert.equal(encodeQ("a\uD800b"), null);
  assert.equal(encodeQ("\uDC00"), null);
  assert.equal(handoffUrl("/tmp", "a\uD800b"), "");
  assert.equal(handoffUrl("a\uD800b", "fine"), "");
  assert.equal(encodeQ(null), "", "…while a null INPUT is simply the empty component");
});

// ── 2. THE HANDLER BUNDLE ─────────────────────────────────────────────────────

test("both install locations are probed, the per-user one first", () => {
  // macOS registers the handler only after the user's first-ever interactive `claude`
  // prompt, so a fresh install has no handler at all and the deep link must not be tried.
  assert.deepEqual(handlerAppPaths("/Users/sam"), [
    "/Users/sam/Applications/Claude Code URL Handler.app",
    "/Applications/Claude Code URL Handler.app",
  ]);
  assert.deepEqual(handlerAppPaths("/Users/sam/"), handlerAppPaths("/Users/sam"), "a trailing slash is normalized");
  assert.deepEqual(handlerAppPaths(""), ["/Applications/Claude Code URL Handler.app"], "no home, no user path");
  assert.deepEqual(handlerAppPaths(null), handlerAppPaths(""));
  assert.equal(pure.HANDLER_APP, "Claude Code URL Handler.app", "the bundle name, as installed");
  // It is a DIRECTORY probe: an .app is a bundle, and statSync on a file would be a false hit.
  assert.match(fnOf(SRC, "bundleExists"), /fs\.statSync\(p\)\.isDirectory\(\)/);
});

// ── 3. THE ROUTE DECISION ─────────────────────────────────────────────────────

test("only a present handler AND a URL that fits earns the deep link", () => {
  // 4,096 is MEASURED, not documented: bisected on a real install on 2026-08-02, where a
  // 4,096-character URL opened a window and a 4,097-character one did nothing whatsoever.
  // The documented 5,000 is on `q` alone and is unreachable, because the scheme and the cwd
  // are inside the same budget. Routing on `q` is what shipped the dead button.
  assert.equal(URL_MAX_CHARS, 4096, "the measured ceiling on the WHOLE url");
  assert.ok(!/\bQ_MAX_CHARS\b|\bqChars\b/.test(SRC), "the q-only cap is gone, name and all");
  assert.equal(chooseRoute({ hasHandler: true, urlChars: 1 }), "deep-link");
  assert.equal(chooseRoute({ hasHandler: true, urlChars: 4095 }), "deep-link");
  assert.equal(chooseRoute({ hasHandler: true, urlChars: 4096 }), "deep-link", "4,096 is the last value delivered");
  assert.equal(chooseRoute({ hasHandler: true, urlChars: 4097 }), "clipboard", "4,097 is the one that vanishes");
  // The old cap must not be honoured under the new name: a URL that clears 5,000 on `q` is
  // exactly the shape that was silently dropped in production.
  assert.equal(chooseRoute({ hasHandler: true, urlChars: 4200 }), "clipboard", "under 5,000 is not the question");
});

test("every uncertainty falls to the clipboard, never to a silent nothing", () => {
  const clipboardCases = [
    ["no handler bundle", { hasHandler: false, urlChars: 10 }],
    ["handler unknown", { hasHandler: undefined, urlChars: 10 }],
    ["handler truthy but not true", { hasHandler: 1, urlChars: 10 }],
    ["over the cap", { hasHandler: true, urlChars: 9999 }],
    ["unmeasurable url", { hasHandler: true, urlChars: NaN }],
    ["infinite", { hasHandler: true, urlChars: Infinity }],
    ["unbuildable url ('' measures 0)", { hasHandler: true, urlChars: 0 }],
    ["negative", { hasHandler: true, urlChars: -1 }],
    ["a string length", { hasHandler: true, urlChars: "10" }],
    ["the OLD key, now meaningless", { hasHandler: true, qChars: 10 }],
    ["nothing at all", {}],
    ["no spec", undefined],
  ];
  for (const [label, spec] of clipboardCases) {
    assert.equal(chooseRoute(spec), "clipboard", label);
  }
});

// ── The whole action, driven with fakes ───────────────────────────────────────
// `open` is async, and fnOf returns the declaration WITHOUT its `async` keyword, so it is
// restored here and the real source is pinned to still carry it.

test("open() is declared async, so the awaited openExternal really is awaited", () => {
  assert.match(SRC, /^async function open\(card\) \{$/m);
});

test("HAPPY PATH: the deep link opens, with this channel's own working directory as cwd", () => {
  const { open, log } = harness();
  return open(CARD).then((res) => {
    assert.deepEqual(res, { ok: true, route: "deep-link" });
    assert.equal(log.opened.length, 1, "one invocation, one terminal window");
    assert.equal(log.copied.length, 0, "and nothing on the clipboard");
    const url = log.opened[0];
    // cwd is PRESENT and ABSOLUTE. It is the same source the spawn path uses
    // (channelDirs.sessionSpawnDir), so an attended session starts where Dopl would have.
    const cwd = decodeURIComponent(/cwd=([^&]*)/.exec(url)[1]);
    assert.equal(cwd, "/Users/sam/Downloads");
    assert.ok(cwd.startsWith("/"), "absolute");
    // The prompt on the wire is the REAL prompt, unaltered.
    const q = decodeURIComponent(/&q=(.*)$/.exec(url)[1]);
    assert.equal(q, PROMPT);
    assert.ok(q.includes(`thread "${TH}"`), "and it is addressed to this thread");
    // BLOCKER B-1, end to end: the card's display strings do not travel.
    assert.ok(!q.includes("David Chen") && !q.includes('"Ops"'), "no peer-typed byte on the wire");
    // ...and the SHIPPED artifact fits, with room to spare for a cwd deeper than this one.
    // The clipboard rung is a fallback, not the feature.
    assert.ok(url.length < 4096 - 300, `the shipped URL is ${url.length} chars, too close to the 4,096 cap`);
  });
});

test("the working directory is always absolute, whatever channel-dirs answers", async () => {
  // A relative or empty cwd on this scheme is not a smaller version of the right answer; it
  // resolves against whatever the handler's own working directory happens to be.
  for (const dir of ["", null, "relative/path", 42, "~/Downloads"]) {
    const { open, log } = harness({ dir });
    await open(CARD);
    const cwd = decodeURIComponent(/cwd=([^&]*)/.exec(log.opened[0])[1]);
    assert.equal(cwd, "/Users/sam", `dir=${JSON.stringify(dir)} degrades to the homedir`);
    assert.ok(cwd.startsWith("/"));
  }
});

test("a channel-dir lookup that THROWS still opens, in the homedir", async () => {
  const { open, log } = harness({ dirThrows: true });
  const res = await open(CARD);
  assert.deepEqual(res, { ok: true, route: "deep-link" });
  assert.match(log.opened[0], /cwd=%2FUsers%2Fsam&/);
});

test("NO HANDLER BUNDLE: the prompt is copied and announced, and openExternal is NEVER called", async () => {
  const { open, log } = harness({ handlerPresent: false });
  const res = await open(CARD);
  assert.deepEqual(res, { ok: true, route: "clipboard" });
  assert.deepEqual(log.opened, [], "a missing handler must not be handed a URL");
  assert.equal(log.copied.length, 1);
  assert.equal(log.copied[0], PROMPT);
  assert.deepEqual(log.notified, [{ title: "Dopl: prompt copied", body: "Paste it into Claude Code and press Enter." }]);
});

test("L-4: the copied banner answers a click by re-copying, and contains a throw", async () => {
  // Every other notification in this app answers a click (task-notify's three open the
  // channel; consent's inbound banner calls its injected onOpen). There is no window to
  // raise from this rung, so the click does the one useful thing left: it puts the prompt
  // back on a pasteboard that may have moved on while the banner was up.
  const { open, log } = harness({ handlerPresent: false });
  await open(CARD);
  assert.equal(log.clicks.length, 1, "a click handler is registered, exactly one");
  assert.equal(log.copied.length, 1);
  log.clicks[0]();
  assert.equal(log.copied.length, 2, "the click re-copied");
  assert.equal(log.copied[1], PROMPT, "...the same prompt, not a second one");
  // A click is not a place to throw: the handler is wrapped, like consent's onOpen.
  assert.match(fnOf(SRC, "notifyCopied"), /n\.on\('click', \(\) => \{\n\s+try \{/);
  const dead = harness({ handlerPresent: false, clipboardThrows: false });
  await dead.open(CARD);
  dead.log.throwOnCopy = true;
  assert.doesNotThrow(() => dead.log.clicks[0](), "a failing re-copy is diagnosed, never thrown");
  assert.ok(dead.log.diag.some((l) => l.includes("notify click failed")));
});

// The harness's cwd is "/Users/sam/Downloads", so this is the exact prefix every URL it
// builds carries. Everything past it is the encoded prompt.
const PREFIX = `claude-cli://open?cwd=${encodeURIComponent("/Users/sam/Downloads")}&q=`.length;

test("THE ROUTE IS DECIDED ON THE BUILT URL, so the cwd counts against the cap", async () => {
  // THE 2026-08-02 LIVE BUG, as a test. A prompt that clears the documented 5,000-character
  // cap on `q` can still push the URL past the 4,096 the handler will carry, and the handler
  // then drops it in silence: openExternal resolves, nothing opens, nothing errors. Routing
  // on `q` alone declared success and the operator got a dead button.
  const overflow = "x".repeat(URL_MAX_CHARS - PREFIX + 1); // one character too many, WITH cwd
  assert.ok(overflow.length < 5000, "and it is comfortably inside the documented cap on q");
  const { open, log } = harness({ prompt: () => overflow });
  assert.deepEqual(await open(CARD), { ok: true, route: "clipboard" });
  assert.deepEqual(log.opened, [], "a URL the handler would swallow is never handed to it");
  assert.equal(log.copied[0], overflow, "the whole prompt, uncut, on the clipboard instead");

  // One character shorter is EXACTLY at the cap, and that one does open.
  const fits = "x".repeat(URL_MAX_CHARS - PREFIX);
  const edge = harness({ prompt: () => fits });
  assert.deepEqual(await edge.open(CARD), { ok: true, route: "deep-link" });
  assert.equal(edge.log.opened[0].length, URL_MAX_CHARS, "4,096 on the nose is delivered");
  assert.deepEqual(edge.log.copied, [], "and nothing lands on the clipboard");
});

test("A LONGER WORKING DIRECTORY is what pushes a fitting prompt over, and it routes too", async () => {
  // The prompt is one term of the sum. attended-prompt.js holds its encoded length under
  // 3,650 so an ordinary cwd fits; a deep enough custom channel directory still overflows,
  // and that case must degrade to a paste rather than to nothing.
  const prompt = "x".repeat(3600);
  const near = harness({ prompt: () => prompt, dir: "/Users/sam/Downloads" });
  assert.deepEqual(await near.open(CARD), { ok: true, route: "deep-link" }, "an ordinary cwd fits");
  const deep = harness({ prompt: () => prompt, dir: `/Users/sam/${"nested/".repeat(80)}channel` });
  assert.deepEqual(await deep.open(CARD), { ok: true, route: "clipboard" }, "a very deep one does not");
  assert.deepEqual(deep.log.opened, []);
  assert.equal(deep.log.copied[0], prompt, "the prompt is still intact on the clipboard");
});

test("AN OVER-CAP PROMPT: copied, not truncated, and the deep link is not attempted", async () => {
  // The answer must be a paste rather than a prompt cut in half: half a procedure is worse
  // than none.
  const { open, log } = harness({ prompt: () => "x".repeat(5001) });
  const res = await open(CARD);
  assert.deepEqual(res, { ok: true, route: "clipboard" });
  assert.deepEqual(log.opened, []);
  assert.equal(log.copied[0].length, 5001, "the whole prompt, uncut");
});

test("open() builds the URL BEFORE it chooses a route, and routes on that URL's length", () => {
  // The ordering IS the fix: a route chosen from the prompt cannot see the cwd, and the cwd
  // is inside the same 4,096 characters. Pinned on the source because a later refactor that
  // moved handoffUrl back under the `if` would pass every behavioural test above on this
  // machine's short home directory and fail on someone's deep one.
  const body = fnOf(SRC, "open");
  const built = body.indexOf("const url = handoffUrl(");
  const routed = body.indexOf("chooseRoute(");
  const branch = body.indexOf("if (route === 'deep-link')");
  assert.ok(built > -1, "open() must build the url into a const");
  assert.ok(built < routed, "the url is built before the route is chosen");
  assert.ok(routed < branch, "and the route is chosen before the branch that uses it");
  // The terminal rung's two inputs, still read live and still measured on the BUILT url. The
  // app rung's fields sit alongside them in the same call (attended-app-route.test.mjs pins
  // those); what matters here is that neither of these two moved or went stale.
  assert.match(body, /chooseRoute\(\{[\s\S]{0,200}?hasHandler: handlerInstalled\(\), urlChars: url\.length,?\s*\}\)/);
  assert.ok(!/handoffUrl\(/.test(body.slice(branch)), "the url is not rebuilt inside the branch");
});

test("AN UNENCODABLE PROMPT: copied rather than thrown out of the click", async () => {
  const { open, log } = harness({ prompt: () => "before\uD800after" });
  const res = await open(CARD);
  assert.deepEqual(res, { ok: true, route: "clipboard" });
  assert.deepEqual(log.opened, []);
  assert.equal(log.copied[0], "before\uD800after");
  assert.ok(log.diag.some((l) => l.includes("unencodable")));
});

test("openExternal REJECTING falls through to the clipboard, and says so", async () => {
  const { open, log } = harness({ openExternal: () => Promise.reject(new Error("no handler after all")) });
  const res = await open(CARD);
  assert.deepEqual(res, { ok: true, route: "clipboard" }, "the operator is not left with nothing");
  assert.equal(log.opened.length, 1, "it was tried");
  assert.equal(log.copied.length, 1, "...and then copied");
  assert.ok(log.diag.some((l) => l.includes("openExternal failed")));
});

test("A CLIPBOARD THAT THROWS reports {ok:false}, so the card can say nothing happened", async () => {
  const { open, log } = harness({ handlerPresent: false, clipboardThrows: true });
  assert.deepEqual(await open(CARD), { ok: false, reason: "clipboard" });
  assert.deepEqual(log.notified, [], "no banner claiming a copy that did not happen");
});

test("FAIL CLOSED: an id that does not narrow opens nothing and copies nothing", async () => {
  for (const bad of [{ channelId: "" }, { workspaceId: null }, { taskId: "   " }, { channelId: "@@@" }]) {
    const { open, log } = harness();
    const res = await open({ ...CARD, ...bad });
    assert.deepEqual(res, { ok: false, reason: "bad-id" }, JSON.stringify(bad));
    assert.deepEqual(log.opened, [], "nothing opened");
    assert.deepEqual(log.copied, [], "nothing copied");
    assert.deepEqual(log.notified, [], "nothing announced");
  }
  const { open } = harness();
  assert.deepEqual(await open(), { ok: false, reason: "bad-id" }, "no card at all");
});

test("the diag line never carries the prompt, the path, or a full id", async () => {
  // The channel dir is personal to this machine and is never logged (channel-dirs privacy
  // rule); the prompt is long and pointless in a log.
  const { open, log } = harness();
  await open(CARD);
  const joined = log.diag.join("\n");
  assert.ok(!joined.includes("/Users/sam/Downloads"), "no path");
  assert.ok(!joined.includes("ToolSearch"), "no prompt");
  assert.ok(!joined.includes(CH), "not the whole channel id");
  assert.ok(joined.includes(CH.slice(0, 8)), "just the short prefix, like every other diag");
});

// ── 4. IT RESOLVES NOTHING (the property Accept depends on) ───────────────────

test("DEPENDENCY SET: attended-handoff cannot reach anything that spawns, posts or decides", () => {
  // The strongest available pin, and the same one the passive-notify lane carries: this
  // module cannot spawn, cannot patch a consent row, cannot poke the watcher and cannot post
  // a lifecycle event, because it does not require any of it.
  const deps = [...SRC.matchAll(/require\('([^']+)'\)/g)].map((x) => x[1]).sort();
  assert.deepEqual(deps, ["./attended-prompt", "./channel-dirs", "./diag", "electron", "fs", "os"]);
  for (const reachable of [/consent/i, /watcher/i, /session-engine/, /spawner/, /channel-post/, /trigger/]) {
    assert.doesNotMatch(deps.join(" "), reachable, `it must not require ${reachable}`);
  }
  // ...and the electron surface it does take is three read/write leaves, no BrowserWindow.
  assert.match(SRC, /^const \{ shell, clipboard, Notification \} = require\('electron'\);$/m);
});

test("the IPC handler resolves the card from the WINDOW and decides nothing on it", () => {
  const handler = between(IPC, "ipcMain.handle('session:attended-handoff'", "// ── Item 5: the folder pill", "session-ipc");
  // Bound from event.sender like every other handler: there is no id in the payload to forge.
  assert.match(handler, /engine\.getConsentBySender && engine\.getConsentBySender\(e && e\.sender\)/);
  assert.match(handler, /if \(!c\) return \{ ok: false, reason: 'no-card' \};/, "no card, no handoff");
  assert.match(handler, /return attended\.open\(c\);/, "and the card itself is what is handed over");
  for (const forbidden of [/decideConsent/, /patchDecision/, /watcher/, /dispatch/, /launch/, /spawn/, /postTaskEvent/, /settle/]) {
    assert.doesNotMatch(handler, forbidden, `the attended handler reaches ${forbidden}`);
  }
});

test("the pre-consent state machine never learns about the handoff, so Accept is untouched", () => {
  // The consent row stays PENDING. `consentTransition` has no 'attend' event and no new
  // terminal phase, which is exactly why clicking Accept afterwards still behaves as today.
  assert.ok(!/attend/i.test(fnOf(CONSENT, "consentTransition")), "the transition is unchanged");
  assert.ok(!/require\('\.\/attended/.test(CONSENT), "session-consent does not even import it");
  assert.ok(!/attend/i.test(fnOf(CONSENT, "decide")), "and decide() is unchanged");
  // Nor does the state machine gain a phase for it: `pending` is still the only phase Accept
  // can be answered from, and the handoff leaves the entry in it.
  assert.deepEqual(
    [...codeOnly(CONSENT).matchAll(/phase: '([a-z-]+)'/g)].map((m) => m[1]).sort(),
    ["accepted", "denied", "parked", "pending"]
  );
});

test("BLOCKER B-1: the handoff reads NO display string, and the entry holds none for it", () => {
  // The prompt takes three ids. The plumbing that used to feed it two peer-typed names is
  // gone at BOTH ends: attended-handoff passes only ids, and the consent entry no longer
  // keeps the names at all. They still reach the RENDERER (`from` / `channelName` on the
  // consent_request payload), where they are display data behind textContent.
  const open = fnOf(SRC, "open");
  // ONE object, read off the card once, and BOTH templates are built from it: a field that
  // cannot be added here cannot reach either prompt.
  assert.match(open, /const ids = \{\n\s+channelId: c\.channelId,\n\s+workspaceId: c\.workspaceId,\n\s+threadId: c\.taskId,/);
  assert.match(open, /const prompt = buildAttendedPrompt\(ids\);/);
  assert.match(open, /const compact = buildAttendedPromptCompact\(ids\);/);
  for (const gone of ["requesterName", "peerName", "bodyText", "bodyPreview"]) {
    assert.ok(!codeOnly(SRC).includes(gone), `attended-handoff still names ${gone}`);
  }
  const entry = between(CONSENT, "  const e = {", "  bind(e);", "session-consent");
  for (const gone of ["requesterName", "channelName"]) {
    assert.ok(!codeOnly(entry).includes(`${gone}:`), `the consent entry still keeps ${gone} for the handoff`);
  }
  // ...and the renderer still gets both, so the CARD itself is unchanged.
  assert.match(CONSENT, /from: spec\.requesterName \|\| null,/);
  assert.match(CONSENT, /channelName: spec\.channelName \|\| null,/);
});

test("the preload exposes ONE argument-free member for it", () => {
  assert.match(PRELOAD, /attendedHandoff\(\) \{\n\s+return ipcRenderer\.invoke\('session:attended-handoff', \{\}\);\n\s+\},/);
  // No text crosses: the page cannot inject a single character into the prompt.
  assert.ok(!/attended-handoff', \{ [a-z]/.test(PRELOAD), "the payload is empty, always");
});
