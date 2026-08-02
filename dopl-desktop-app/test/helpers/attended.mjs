// Shared fixtures for the F-118 attended-handoff suites (no tests of its own).
//
// THREE suites now drive the same two modules: attended-prompt (the full template),
// attended-app-route (the compact template and the app rung) and attended-handoff (the
// ladder and the module's negative properties). What they share is here, and it is here
// rather than copied because two of the three things below are LOAD-BEARING and a drifted
// copy would be a silently weaker test:
//
//   PEER_FIELDS is the ZERO PEER BYTES sweep. Both templates are swept with the same list,
//   so a field added for one and forgotten for the other cannot pass.
//   handoffHarness() is the source extraction that drives the REAL open(). Two copies of a
//   brace-matched harness is exactly the shape that rots: one gets a new fake, the other
//   keeps passing against a function it no longer resembles.
//
// The fs fake is PATH-AWARE (2026-08-02) because there are now two bundles to probe and they
// route to different rungs. `appPresent` defaults to FALSE so a test that says nothing about
// the app gets the terminal ladder exactly as it did before the app rung existed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf } from "./source-probe.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
export const mainSrc = (p) => readFileSync(join(HERE, "..", "..", "main", p), "utf8");
const SRC = mainSrc("attended-handoff.js");

export const CH = "aaaaaaaa-1111-4bbb-8ccc-dddddddddddd";
export const WS = "bbbbbbbb-2222-4ccc-8ddd-eeeeeeeeeeee";
export const TH = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
export const LEGACY = `task-${CH}-42`;

// The display strings are on this fixture ON PURPOSE, and they are on nothing else: BLOCKER
// B-1 took them off the consent entry AND out of both prompts, so a card that still carried
// them must produce the same prompt as one that does not.
export const CARD = { channelId: CH, workspaceId: WS, taskId: TH, requesterName: "David Chen", channelName: "Ops" };

// Every field a caller (or a future "helpful" edit) might reach for to smuggle peer-typed
// text into a prefill. NONE of them are parameters of either template.
export const PEER_FIELDS = [
  "peerName", "channelName", "requesterName", "displayName", "from", "name", "author",
  "body", "bodyText", "bodyPreview", "body_preview", "summary", "message", "text",
  "preview", "request", "taskTitle", "title", "proposedReply",
];

// The module's constants, read out of the source as literals so the harness runs against the
// SHIPPED numbers rather than against restated ones.
const CONSTS = ["SCHEME", "APP_SCHEME", "URL_MAX_CHARS", "APP_PARAM_MAX_CHARS", "HANDLER_APP", "APP_BUNDLE", "COPIED_TITLE", "COPIED_BODY"]
  .map((n) => {
    const m = new RegExp(`^const ${n} = (.+);$`, "m").exec(SRC);
    assert.ok(m, `attended-handoff must define ${n}`);
    return `const ${n} = ${m[1]};`;
  })
  .join("\n");

// The REAL functions, wired to fakes. Everything the module actually calls is recorded.
//
// `clicks` holds the banner's click handlers (L-4), so the notification can be driven the way
// the operator drives it; `throwOnCopy` lets a LATER clipboard write fail than the first one.
export function handoffHarness(over = {}) {
  const { buildAttendedPrompt, buildAttendedPromptCompact } = require("../../main/attended-prompt.js");
  const log = { opened: [], copied: [], notified: [], diag: [], clicks: [], throwOnCopy: false };
  const fakes = {
    handlerPresent: true,
    appPresent: false, // the app rung is opt-in: silence means the ladder starts at rung 2
    openExternal: () => Promise.resolve(),
    prompt: buildAttendedPrompt,
    compact: buildAttendedPromptCompact,
    dir: "/Users/sam/Downloads",
    ...over,
  };
  const body = [
    CONSTS,
    fnOf(SRC, "encodeQ"),
    fnOf(SRC, "handoffUrl"),
    fnOf(SRC, "handlerAppPaths"),
    fnOf(SRC, "appBundlePaths"),
    fnOf(SRC, "appLink"),
    fnOf(SRC, "fits"),
    fnOf(SRC, "chooseRoute"),
    fnOf(SRC, "bundleExists"),
    fnOf(SRC, "handlerInstalled"),
    fnOf(SRC, "appInstalled"),
    fnOf(SRC, "cwdFor"),
    fnOf(SRC, "notifyCopied"),
    fnOf(SRC, "copyFallback"),
    "async " + fnOf(SRC, "open"),
    "return open;",
  ].join("\n");
  const open = new Function(
    "shell", "clipboard", "Notification", "channelDirs", "buildAttendedPrompt", "buildAttendedPromptCompact", "diag", "fs", "os", body
  )(
    { openExternal: (url) => { log.opened.push(url); return fakes.openExternal(url); } },
    { writeText: (t) => { if (fakes.clipboardThrows || log.throwOnCopy) throw new Error("no pasteboard"); log.copied.push(t); } },
    Object.assign(
      function Notice(o) {
        log.notified.push(o);
        return { show() {}, on(k, fn) { if (k === "click") log.clicks.push(fn); } };
      },
      { isSupported: () => true }
    ),
    { sessionSpawnDir: () => (fakes.dirThrows ? (() => { throw new Error("nope"); })() : fakes.dir) },
    fakes.prompt,
    fakes.compact,
    (...parts) => log.diag.push(parts.join(" ")),
    // Which bundle is being probed decides the answer: the two rungs have two install
    // locations and a test must be able to have one without the other.
    { statSync: (p) => ({ isDirectory: () => (String(p).includes("Claude Code URL Handler.app") ? fakes.handlerPresent : fakes.appPresent) }) },
    { homedir: () => "/Users/sam" }
  );
  return { open, log };
}
