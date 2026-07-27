// Truth-table tests for the Channels listener's `classify()` targeting verdict.
//
// Run: `node --test dopl-desktop-app/test/classify.test.mjs`
//   (or point --test at any glob that includes this file).
//
// WHY SOURCE EXTRACTION: targeting.js (like the rest of dopl-desktop-app/main)
// is a CommonJS module and `classify` is private (non-exported). Rather than
// touch production code to export it, this test reads the real source and
// evaluates the exact `classify` + `metaStr` definitions verbatim. If the source
// changes, the extracted functions change with it, so the test stays honest to
// prod. (This already paid off: it surfaced two rules — self-addressed-noise and
// the implicit-mute — that a stale copy of the function did not have.)
//
// SPLIT NOTE: `classify`/`metaStr` moved from channel-listener.js to targeting.js
// in the §2 refactor; the source path below was repointed in the same change.
//
// File is `.mjs` (ESM) so it stays clean under the repo's shared eslint config,
// which flags the CommonJS `require()` the rest of dopl-desktop-app/main uses.

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

// Build the real classify() in an isolated scope alongside its metaStr helper.
const { classify } = new Function(
  `${extractFn("metaStr")}\n${extractFn("classify")}\nreturn { classify, metaStr };`
)();

const ME = "me-uuid";
const U2 = "author-uuid"; // a foreign author
const U3 = "third-uuid"; // a distinct third party

// Reference oracle re-derived from the CURRENT source's documented rules:
//   guards (fail closed): message kind, user author, author present, known id,
//     never my own message.
//   addressed (to_user_id present):
//     - to === me            -> trigger (explicit address always prompts)
//     - to === the author    -> ignore  (self-addressed noise)
//     - else                 -> fyi (member) / ignore (public non-member)
//   unaddressed:
//     - exactly 2 members + member -> trigger, UNLESS myNotifyScope === 'none'
//       (an explicit mute wins over an IMPLICIT target) -> ignore
//     - otherwise            -> fyi (member) / ignore (public non-member)
function oracle(m, entry, myId) {
  if (!m || m.kind !== "message" || m.authorKind !== "user" || !m.authorUserId) return "ignore";
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
const AUTHOR_KINDS = ["user", "agent"];
const KINDS = ["message", "task_started"];
const SCOPES = ["all", "addressed", "none", "undefined"];

test("classify truth table — full combination sweep matches the spec oracle", () => {
  let n = 0;
  for (const to of TO)
    for (const memberCount of MEMBER_COUNTS)
      for (const isMember of IS_MEMBERS)
        for (const author of AUTHORS)
          for (const authorKind of AUTHOR_KINDS)
            for (const kind of KINDS)
              for (const myNotifyScope of SCOPES) {
                const m = makeMsg({ to, author, authorKind, kind });
                const entry = makeEntry({ memberCount, isMember, myNotifyScope });
                const got = classify(m, entry, ME);
                const want = oracle(m, entry, ME);
                assert.equal(
                  got,
                  want,
                  `to=${to} members=${memberCount} isMember=${isMember} author=${author} authorKind=${authorKind} kind=${kind} scope=${myNotifyScope} -> got ${got}, want ${want}`
                );
                n++;
              }
  assert.equal(
    n,
    TO.length *
      MEMBER_COUNTS.length *
      IS_MEMBERS.length *
      AUTHORS.length *
      AUTHOR_KINDS.length *
      KINDS.length *
      SCOPES.length
  );
});

// ── Explicit, hand-reasoned expectations (independent of the oracle) ─────────

const foreign = { authorUserId: U2, authorKind: "user", kind: "message", id: "x", seq: 1, body: "hi" };
const to = (tid) => ({ ...foreign, metadata: { to_user_id: tid } });
const plain = { ...foreign, metadata: {} };

test("fail-closed guards -> ignore", () => {
  const entry = makeEntry({ memberCount: 2, isMember: true });
  assert.equal(classify({ ...plain, kind: "task_started" }, entry, ME), "ignore"); // non-message
  assert.equal(classify({ ...plain, authorKind: "agent" }, entry, ME), "ignore"); // agent author
  assert.equal(classify({ ...plain, authorUserId: null }, entry, ME), "ignore"); // no author id
  assert.equal(classify(plain, entry, null), "ignore"); // unknown operator identity
});

test("my own message -> ignore (never self-trigger)", () => {
  const mine = { ...plain, authorUserId: ME };
  assert.equal(classify(mine, makeEntry({ memberCount: 2, isMember: true }), ME), "ignore");
});

test("addressed to me -> trigger, regardless of member count, membership, or mute", () => {
  assert.equal(classify(to(ME), makeEntry({ memberCount: 3, isMember: true }), ME), "trigger");
  assert.equal(classify(to(ME), makeEntry({ memberCount: 3, isMember: false }), ME), "trigger");
  // An explicit address is never suppressed by a per-channel mute.
  assert.equal(
    classify(to(ME), makeEntry({ memberCount: 2, isMember: true, myNotifyScope: "none" }), ME),
    "trigger"
  );
});

test("self-addressed noise (to === author) -> ignore", () => {
  assert.equal(classify(to(U2), makeEntry({ memberCount: 2, isMember: true }), ME), "ignore");
});

test("addressed to a third party -> fyi as a member, ignore as a public non-member", () => {
  assert.equal(classify(to(U3), makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
  assert.equal(classify(to(U3), makeEntry({ memberCount: 3, isMember: false }), ME), "ignore");
});

test("unaddressed + exactly 2 members + member -> trigger (implicit 1:1)", () => {
  assert.equal(classify(plain, makeEntry({ memberCount: 2, isMember: true }), ME), "trigger");
});

test("unaddressed + 2 members + member + myNotifyScope 'none' -> ignore (implicit mute)", () => {
  assert.equal(
    classify(plain, makeEntry({ memberCount: 2, isMember: true, myNotifyScope: "none" }), ME),
    "ignore"
  );
  // 'addressed' does NOT mute the implicit trigger (only 'none' does).
  assert.equal(
    classify(plain, makeEntry({ memberCount: 2, isMember: true, myNotifyScope: "addressed" }), ME),
    "trigger"
  );
});

test("unaddressed + 3+ members -> fyi (classify never mutes fyi; sendFyi() does)", () => {
  assert.equal(classify(plain, makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
  assert.equal(
    classify(plain, makeEntry({ memberCount: 3, isMember: true, myNotifyScope: "none" }), ME),
    "fyi"
  );
});

test("unaddressed + unknown/invalid memberCount -> fyi (degrades to multi-member)", () => {
  assert.equal(classify(plain, makeEntry({ memberCount: undefined, isMember: true }), ME), "fyi");
  assert.equal(classify(plain, makeEntry({ memberCount: 0, isMember: true }), ME), "fyi");
});

test("isMember missing field degrades to member (fyi, not ignore)", () => {
  assert.equal(classify(plain, makeEntry({ memberCount: 3, isMember: "undefined" }), ME), "fyi");
});
