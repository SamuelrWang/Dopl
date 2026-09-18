// R-21 (2026-09-17): THERE IS NO ARCHIVE. A CHANNEL EXISTS OR IT IS DELETED.
//
// The ruling removed the feature across the web and the SPA, and INVARIANTS §15
// states the outcome plainly: a row carrying an old `archived_at` stamp "now
// appears in every list, count and activity feed as an ordinary channel. Nothing
// hides a row for having one; nothing may start."
//
// The desktop main process kept one reader. `reconcile` skipped any channel whose
// DTO carried `archivedAt`, so that channel got NO listener loop at all — no
// `/await` long-poll, no auto-responder, no notification, no presence — while the
// web and the SPA listed it as ordinary. `Channel.archivedAt` is still emitted
// (`channels/server/dto.ts`), so the stamp was live input to dead logic.
//
// This pins the ABSENCE, which is the only thing a deletion can be pinned by.
//
// Run: `node --test dopl-desktop-app/test/listener-no-archive.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const MAIN = join(here, "..", "main");

test("the main process holds no reader of the archived flag", () => {
  for (const file of ["channel-listener.js", "channel-poll.js", "notify.js"]) {
    let src;
    try {
      src = readFileSync(join(MAIN, file), "utf8");
    } catch {
      continue; // the file may not exist; the assertion is about what does.
    }
    assert.equal(
      /\barchivedAt\b|\barchived_at\b/.test(src.replace(/^\s*\/\/.*$/gm, "")),
      false,
      `${file} still branches on the archived flag — R-21 deleted the feature`
    );
  }
});
