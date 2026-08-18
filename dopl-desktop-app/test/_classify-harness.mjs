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
// `mentionsMe` (2026-08-18, wiring plan Phase 7) is the SECOND such free variable, written to
// the same rule and for the same reason: the dispatcher gates the task-reply notice on the
// answer classify uses for its 'fyi' verdict, so it lives outside the body and its
// MENTIONS_KEY const lives inside itself.
const build = () =>
  new Function(
    `${extractFn("metaStr")}\n${LEGACY}\n${extractFn("isChatIntent")}\n${extractFn("mentionsMe")}\n` +
      `${extractFn("classify")}\n` +
      `return { classify, metaStr, isChatIntent, mentionsMe, noteMyLegacyThread, knownLegacyReply, legacyThreadId };`
  )();
const { classify, mentionsMe } = build();

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
//     - to === the author    -> ignore  (self-addressed noise; a tag does NOT
//                              rescue it — the branch is a loop brake)
//     - else                 -> fyi (member AND tagged me) / ignore
//   unaddressed, EITHER author kind:
//     - fyi (member AND tagged me) / ignore. NEVER a trigger, at any member
//       count.
//       ⚠ EVERY 'fyi' IS MENTION-GATED (2026-08-18, wiring plan Phase 7). The
//       verdict used to mean "a message I can see"; it now means "a message
//       that @-tagged me", read off the SERVER-STAMPED `metadata
//       .mentionedUserIds` — the same unspoofable-key discipline `to_user_id`
//       gets. A member post that names nobody is 'ignore': no desktop banner,
//       and the Tags inbox is still the record. 'trigger' is deliberately NOT
//       gated — an addressed request is a decision somebody waits on.
//       ⚠ THE IMPLICIT 1:1 TRIGGER IS GONE (2026-08-18, wiring plan Phase 3):
//       an unaddressed USER post in an exactly-2-member channel used to be
//       'trigger', paired with the server's DM auto-address. Both retired
//       together — addressing is explicit everywhere now. The member count is
//       not read at all, which is why this oracle no longer reads it either.
//       ⚠ THIS ORACLE AND `classify` MUST MOVE IN THE SAME COMMIT. It is a
//       SECOND statement of the rule, deliberately (that is what makes the
//       576-case sweep worth running) — and a second statement is a second
//       thing to forget.
function oracle(m, entry, myId) {
  if (!m || m.kind !== "message" || !m.authorUserId) return "ignore";
  if (m.authorKind !== "user" && m.authorKind !== "agent") return "ignore";
  if (!myId) return "ignore";
  if (m.authorUserId === myId) return "ignore";

  const ch = entry.channel;
  const isMember = !(ch && ch.isMember === false);
  // The SECOND statement of the mention read, re-derived rather than shared: a
  // non-array value is no mention, and the author's own tag never reaches here
  // because the server drops it before stamping.
  const tagged =
    Array.isArray(m.metadata && m.metadata.mentionedUserIds) &&
    m.metadata.mentionedUserIds.some((id) => typeof id === "string" && id.trim() === myId);
  const notify = isMember && tagged ? "fyi" : "ignore";
  // A post that declared it addresses nobody triggers nobody, whoever wrote it — and it takes
  // the same mention gate as everything else, which is what makes a human DM notify when you
  // are tagged and stay silent when you are not. ⚠ ABOVE the addressed rules, mirroring
  // classify: `intent: "chat"` + an explicit `to` is a 400 server-side, but the desktop must
  // not depend on that, so the ORDER is the thing pinned here.
  if (m.metadata && m.metadata.intent === "chat") return notify;
  const to =
    m.metadata && typeof m.metadata.to_user_id === "string" && m.metadata.to_user_id.trim()
      ? m.metadata.to_user_id.trim()
      : "";
  if (to) {
    if (to === myId) return "trigger";
    if (to === m.authorUserId) return "ignore";
    return notify;
  }
  // Unaddressed, any author kind -> the mention gate. The member count is not read.
  return notify;
}

// `to` targets: me / the author itself (self-addressed) / a third party / none.
function targetId(to, authorId) {
  if (to === "me") return ME;
  if (to === "author") return authorId;
  if (to === "third") return U3;
  return null;
}

// The SERVER-STAMPED mention set, in the four shapes a real row can carry:
// nobody (the key is absent, which is every pre-Phase-6 row), somebody else,
// me, and a MALFORMED value — the last because the key is read off the wire and
// a non-array must degrade to "tags nobody" rather than throw or be trusted.
function mentionSet(mentions) {
  if (mentions === "me") return { mentionedUserIds: [ME] };
  if (mentions === "other") return { mentionedUserIds: [U3] };
  if (mentions === "both") return { mentionedUserIds: [U3, ME] };
  if (mentions === "malformed") return { mentionedUserIds: ME };
  return {};
}

function makeMsg({ to, author, authorKind, kind, mentions = "absent", intent = "absent" }) {
  const authorUserId = author === "me" ? ME : U2;
  const tid = targetId(to, authorUserId);
  return {
    id: "x",
    seq: 1,
    body: "hi",
    kind,
    authorKind,
    authorUserId,
    metadata: {
      ...(tid ? { to_user_id: tid } : {}),
      ...(intent === "absent" ? {} : { intent }),
      ...mentionSet(mentions),
    },
  };
}

function makeEntry({ memberCount, isMember }) {
  const channel = { id: "chan-abcdef01", name: "General", memberCount };
  if (isMember !== "undefined") channel.isMember = isMember;
  return { channel };
}

const TO = ["me", "author", "third", "absent"];
const MEMBER_COUNTS = [2, 3, undefined, 0];
const IS_MEMBERS = [true, false, "undefined"];
const AUTHORS = ["me", "other"];
const AUTHOR_KINDS = ["user", "agent", "system"];
const KINDS = ["message", "task_started"];
// The mention dimension, added 2026-08-18 with the notification gate. FOUR
// values, not two: "other" is what proves the read is an identity match rather
// than a presence check, and "malformed" is what proves a wire value the server
// could never write degrades to silence instead of throwing inside the listener.
const MENTIONS = ["absent", "me", "other", "malformed"];
// The intent axis, added 2026-08-18 in the same pass — and found by MUTATION-VERIFYING the
// mention gate rather than by reading. Mutating the gate off the CHAT branch moved 0 of the
// 2304 cases the table then had, because the sweep had never built a chat post at all: the
// brake had lived only in the hand-written tests since 2026-08-06. With this axis that same
// mutation moves cases, which is the whole claim a truth table makes.
const INTENTS = ["absent", "chat"];

export {
  extractFn,
  SRC,
  LEGACY,
  build,
  classify,
  mentionsMe,
  ME,
  U2,
  U3,
  oracle,
  targetId,
  makeMsg,
  makeEntry,
  mentionSet,
  TO,
  MEMBER_COUNTS,
  IS_MEMBERS,
  AUTHORS,
  AUTHOR_KINDS,
  KINDS,
  MENTIONS,
  INTENTS,
};
