// THE SHARED CLASSIFY HARNESS — source extraction, fixtures, and the fresh-scope builder.
//
// WHY IT IS ITS OWN MODULE (§2 split, 2026-08-05, F-146). `classify.test.mjs` sat at EXACTLY
// 500 lines, so the next assertion anybody added to the tree's most-exercised truth table
// would have failed `npm run lint` — and the reflex fix for that is to delete a comment,
// which is how eight files in this repo converged on the same two numbers. The seam taken
// instead is a REAL one: the LEGACY-THREAD registry cases are about PROVENANCE THIS MACHINE
// RECORDS (a local Map, one fresh scope per test) while the rest is about a message's own
// fields, so they were already the one group that had to build its own scope.
//
// WHY SOURCE EXTRACTION: `targeting.js` (like the rest of `main/`) is CommonJS and `classify`
// is private. Rather than touch production code to export it, this reads the real source and
// evaluates the exact `classify` + `metaStr` definitions verbatim, so a change to the source
// changes the extracted functions with it and the tests stay honest to prod. (It has already
// paid off: it surfaced two rules — self-addressed-noise and the implicit-mute — that a stale
// copy of the function did not have.)
//
// EVERY CONSUMER MUST CALL `build()` FOR STATE-SENSITIVE CASES. `build()` returns a FRESH
// scope, so the legacy registry cannot leak between tests; the module-level `classify` export
// below is the convenience binding for the stateless majority.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "targeting.js"), "utf8");

// Extract a top-level `function <name>(...) { ... }` block by brace-balancing
// from its opening brace. `classify` and `metaStr` contain no braces inside
// strings/comments/regex, so a plain brace count is exact for them.
function extractFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found in targeting.js`);
  let depth = 0;
  let i = SRC.indexOf("{", start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) {
      i++;
      break;
    }
  }
  return SRC.slice(start, i);
}

// The LEGACY-THREADS block carries module state (the registry Map + its cap), so it is
// sliced WHOLE between its sentinels rather than function by function. classify calls into
// it, so it has to be in the evaluated scope; slicing the real block keeps this harness as
// honest as the brace-balanced functions around it.
// §2 SPLIT (2026-07-31): the LEGACY-THREADS registry classify calls into moved to its own
// module when targeting.js went past the 500-line cap; classify's body did not change, so only
// the FILE this block is sliced out of did. It carries module state, hence the whole-block cut.
const LEGACY_SRC = readFileSync(join(HERE, "..", "main", "legacy-threads.js"), "utf8");
const LEGACY = LEGACY_SRC.slice(
  LEGACY_SRC.indexOf("// ─── BEGIN LEGACY-THREADS"),
  LEGACY_SRC.indexOf("// ─── END LEGACY-THREADS")
);
assert.ok(LEGACY.includes("function knownLegacyReply"), "LEGACY-THREADS sentinels missing");

// Build the real classify() in an isolated scope alongside its metaStr helper. Every
// `new Function` call gets a FRESH registry, so no test can leak state into another.
// `isChatIntent` was hoisted out of classify's body on 2026-08-06 (the dispatcher needs the
// same answer BEFORE classify runs), so it is now a free variable inside the extracted
// classify and has to be evaluated alongside it. It is self-contained by design — its
// CHAT_INTENT const sits inside the function body — so the plain brace-matcher gets all of it.
const build = () =>
  new Function(
    `${extractFn("metaStr")}\n${LEGACY}\n${extractFn("isChatIntent")}\n${extractFn("classify")}\n` +
      `return { classify, metaStr, isChatIntent, noteMyLegacyThread, knownLegacyReply, legacyThreadId };`
  )();
const { classify } = build();

const ME = "me-uuid";
const U2 = "author-uuid"; // a foreign author
const U3 = "third-uuid"; // a distinct third party

// Reference oracle re-derived from the CURRENT source's documented rules.
// UPDATED for the ask-another-agent fix: an agent EXPLICITLY addressed to me
// now triggers (it used to be dropped by a blanket "user author" guard), while
// an UNADDRESSED agent stays FYI/ignore — the loop brake.
//   guards (fail closed): message kind, author present, known id, never my own
//     message; authorKind must be 'user' or 'agent' (else -> ignore, e.g.
//     'system').
//   addressed (to_user_id present) — USER *and* AGENT authors alike:
//     - to === me            -> trigger (explicit address always prompts)
//     - to === the author    -> ignore  (self-addressed noise)
//     - else                 -> fyi (member) / ignore (public non-member)
//   unaddressed AGENT author:
//     - fyi (member) / ignore (public non-member) — NEVER an implicit trigger
//       (LOOP BRAKE: the responder's reply is unaddressed so it can't re-trigger)
//   unaddressed USER author (unchanged):
//     - exactly 2 members + member -> trigger, UNLESS myNotifyScope === 'none'
//       (an explicit mute wins over an IMPLICIT target) -> ignore
//     - otherwise            -> fyi (member) / ignore (public non-member)
function oracle(m, entry, myId) {
  if (!m || m.kind !== "message" || !m.authorUserId) return "ignore";
  if (m.authorKind !== "user" && m.authorKind !== "agent") return "ignore";
  if (!myId) return "ignore";
  if (m.authorUserId === myId) return "ignore";

  const ch = entry.channel;
  const isMember = !(ch && ch.isMember === false);
  const to =
    m.metadata && typeof m.metadata.to_user_id === "string" && m.metadata.to_user_id.trim()
      ? m.metadata.to_user_id.trim()
      : "";
  if (to) {
    if (to === myId) return "trigger";
    if (to === m.authorUserId) return "ignore";
    return isMember ? "fyi" : "ignore";
  }
  // Unaddressed agent -> never an implicit trigger (loop brake); FYI/ignore only.
  if (m.authorKind === "agent") return isMember ? "fyi" : "ignore";
  const cnt = Number(ch && ch.memberCount);
  const knownTwo = Number.isFinite(cnt) && cnt === 2;
  const scope = (ch && ch.myNotifyScope) || "all";
  if (knownTwo && isMember) return scope === "none" ? "ignore" : "trigger";
  return isMember ? "fyi" : "ignore";
}

// `to` targets: me / the author itself (self-addressed) / a third party / none.
function targetId(to, authorId) {
  if (to === "me") return ME;
  if (to === "author") return authorId;
  if (to === "third") return U3;
  return null;
}

function makeMsg({ to, author, authorKind, kind }) {
  const authorUserId = author === "me" ? ME : U2;
  const tid = targetId(to, authorUserId);
  return {
    id: "x",
    seq: 1,
    body: "hi",
    kind,
    authorKind,
    authorUserId,
    metadata: tid ? { to_user_id: tid } : {},
  };
}

function makeEntry({ memberCount, isMember, myNotifyScope }) {
  const channel = { id: "chan-abcdef01", name: "General", memberCount };
  if (isMember !== "undefined") channel.isMember = isMember;
  if (myNotifyScope !== "undefined") channel.myNotifyScope = myNotifyScope;
  return { channel };
}

const TO = ["me", "author", "third", "absent"];
const MEMBER_COUNTS = [2, 3, undefined, 0];
const IS_MEMBERS = [true, false, "undefined"];
const AUTHORS = ["me", "other"];
const AUTHOR_KINDS = ["user", "agent", "system"];
const KINDS = ["message", "task_started"];
const SCOPES = ["all", "addressed", "none", "undefined"];

export {
  extractFn,
  SRC,
  LEGACY,
  build,
  classify,
  ME,
  U2,
  U3,
  oracle,
  targetId,
  makeMsg,
  makeEntry,
  TO,
  MEMBER_COUNTS,
  IS_MEMBERS,
  AUTHORS,
  AUTHOR_KINDS,
  KINDS,
  SCOPES,
};
