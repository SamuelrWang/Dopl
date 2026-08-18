// THE CHANNELS ROLLBACK'S EFFECT ON `classify` (plan §1, 2026-08-05).
//
// D2 put TWO named-agent rules into that function and both are gone. They are pinned here as
// ABSENCES rather than deleted quietly, because each one CHANGED a verdict: restoring either
// would silently re-suppress a trigger the product depends on, and a green suite that never
// asked would not notice. Both cases below were verified RED against `b0c76a8`'s targeting.js.
//
// A SIBLING of classify.test.mjs (which is at the §2 500-line cap), sharing its method: the
// REAL `classify` is brace-balanced out of the shipped source and evaluated, so what is
// tested is what ships. The harness is duplicated rather than exported because the point of
// the extractor is that it reads the file rather than importing a seam somebody could widen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "targeting.js"), "utf8");

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

const LEGACY_SRC = readFileSync(join(HERE, "..", "main", "legacy-threads.js"), "utf8");
const LEGACY = LEGACY_SRC.slice(
  LEGACY_SRC.indexOf("// ─── BEGIN LEGACY-THREADS"),
  LEGACY_SRC.indexOf("// ─── END LEGACY-THREADS")
);

// `isChatIntent` and `mentionsMe` are free variables inside classify — both hoisted out of its
// body so a SECOND reader (listener-messages.js) can ask the same question, and both written
// self-contained so this brace-matcher gets all of each.
const { classify } = new Function(
  `${extractFn("metaStr")}\n${LEGACY}\n${extractFn("isChatIntent")}\n${extractFn("mentionsMe")}\n` +
    `${extractFn("classify")}\nreturn { classify };`
)();

const ME = "me-uuid";
const U2 = "author-uuid";

function makeEntry({ memberCount, isMember }) {
  const channel = { id: "chan-abcdef01", name: "General", memberCount };
  if (isMember !== undefined) channel.isMember = isMember;
  return { channel };
}

/** A foreign HUMAN author's unaddressed message — the shape every case below starts from. */
const plain = {
  id: "x",
  kind: "message",
  authorUserId: U2,
  authorKind: "user",
  metadata: {},
};

//
// D2 put TWO named-agent rules into this function and both are gone. They are pinned as
// ABSENCES rather than deleted quietly, because each one CHANGED a verdict: restoring
// either would silently re-suppress a trigger the product depends on, and a green suite
// that never asked would not notice.

test("(rollback) no leftover entry field consults a team-agent count", () => {
  // "ADDRESS TO ACT": while `entry.teamAgents` was non-zero, an UNADDRESSED human message
  // in a two-member channel triggered NOBODY, because the room held several workers. There
  // is no summoning and no count; the entry's own field is ignored whatever it says.
  //
  // ⚠ RE-AIMED, NOT WEAKENED. This used to assert the verdict was 'trigger' — the
  // implicit 1:1 rule, retired 2026-08-18 with the server's DM auto-address. The
  // ABSENCE it pins is the same one: no stale field on the entry may move a verdict.
  // An ADDRESSED message carries it now, because that is the verdict a resurrected
  // `teamAgents` read would suppress.
  const base = makeEntry({ memberCount: 2, isMember: true });
  const addressed = { ...plain, metadata: { to_user_id: ME } };
  assert.equal(classify(addressed, base, ME), "trigger");
  assert.equal(classify(addressed, { ...base, teamAgents: 3, rosterKnown: true }, ME), "trigger",
    "a stale team count must not suppress an addressed request");
  // The per-channel mute that used to be the ONE exception to this is gone too
  // (F-170, 2026-08-08): notify scope was removed from the product, so nothing
  // — not a stale team count, not a stored preference — suppresses this verdict.
  assert.equal(
    classify(addressed, { ...base, teamAgents: 3, channel: { ...base.channel, myNotifyScope: "none" } }, ME),
    "trigger"
  );
  // And the unaddressed half, stated where a reader will look for it: no field
  // on the entry can turn an unaddressed post back into a trigger either.
  // ⚠ 'ignore' rather than 'fyi' since 2026-08-18 (wiring plan Phase 7) — an unaddressed post
  // that tags nobody now raises no notification either. The ABSENCE this pins is unchanged.
  assert.equal(classify(plain, { ...base, teamAgents: 0, rosterKnown: true }, ME), "ignore");
});

test("(rollback) an agent-authored message to me is a TRIGGER, never 'agent-escalation'", () => {
  // A teammate's NAMED agent addressing me as a PERSON used to classify 'agent-escalation':
  // a notification that started nothing, so a question meant for a human was not answered by
  // another machine. Its conjuncts were `author_agent_id` present and `to_agent_id` absent,
  // and NOTHING stamps either key now — no `as_agent`, no owner bridge. A stored key from
  // before the rollback must therefore take the ordinary addressed path, which is
  // consent-gated, rather than a verdict nothing dispatches any more.
  const fromPeerAgent = {
    id: "x", kind: "message", authorUserId: U2, authorKind: "agent",
    metadata: { to_user_id: ME, author_agent_id: "ag-1" },
  };
  const entry = makeEntry({ memberCount: 3, isMember: true });
  assert.equal(classify(fromPeerAgent, entry, ME), "trigger");
});

test("(rollback) intent:'chat' still suppresses every trigger, at any size", () => {
  // The one addressing rule the rollback KEEPS, and the one that replaces what engagement
  // and the team-agent gate were doing: a post that declared it addresses nobody starts
  // nobody, whoever wrote it and however many members are in the room.
  // ⚠ THE VERDICT WORD MOVED, THE RULE DID NOT (2026-08-18, wiring plan Phase 7): chat that
  // tags nobody is 'ignore' now rather than 'fyi', so the TAGGED variant is what carries the
  // "chat wins over an address" half — the case where a verdict is still produced at all.
  for (const count of [2, 3]) {
    const entry = makeEntry({ memberCount: count, isMember: true });
    const tag = { mentionedUserIds: [ME] };
    assert.equal(classify({ ...plain, metadata: { intent: "chat" } }, entry, ME), "ignore");
    assert.equal(classify({ ...plain, metadata: { intent: "chat", ...tag } }, entry, ME), "fyi");
    assert.equal(
      classify({ ...plain, metadata: { intent: "chat", to_user_id: ME, ...tag } }, entry, ME),
      "fyi",
      "chat wins over an address"
    );
    assert.equal(
      classify({ ...plain, metadata: { intent: "chat", to_user_id: ME } }, entry, ME),
      "ignore",
      "chat wins over an address, and an untagged one raises nothing"
    );
  }
});
