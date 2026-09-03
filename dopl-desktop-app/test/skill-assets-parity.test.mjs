// THE BUNDLED SKILL ASSETS AGREE WITH THE REPO'S OWN.
//
// `scripts/dopl-channel-wait.sh` is the CANONICAL hold loop — the file the MCP
// doctrine, the skill and INVARIANTS all name. The desktop ships a copy inside
// `main/runtime/claude/skills/dopl-channels-wait/` — the Claude adapter, because a
// skills directory is one runtime's convention — and a copy at all because
// electron-builder packages only
// this app's directory and cannot reach `../scripts`, and because a session on
// a machine that never cloned the repo needs the script beside the skill that
// tells it to run one.
//
// ⚠ TWO COPIES OF ONE FILE, SO THEY AGREE BY BYTES OR NOT AT ALL. This is the
// join `runtime-stamp-literals.test.mjs` established for the runtime stamps:
// there is no shared module across it (main is CommonJS Electron, `scripts/` is
// a shell file nothing imports), so a test that reads BOTH sources is the only
// thing standing between "we fixed the script" and "we fixed the copy nobody
// ships". It fails from either side by construction.
//
// ⚠ AND THE SKILL'S OWN CLAIMS ARE PINNED HERE TOO, for the reason the MCP
// tree pins doctrine phrases: the skill is COPIED ONTO THE OPERATOR'S DISK and
// then never updated by a server deploy, so a sentence that stops being true
// outlives every release. What is checked is the small set of things it asserts
// about the server: the refusal word, the doctrine URI, and the exit codes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const CANONICAL = path.join(REPO, 'scripts', 'dopl-channel-wait.sh');
const SKILL_DIR = path.join(
  HERE,
  '..',
  'main',
  'runtime',
  'claude',
  'skills',
  'dopl-channels-wait',
);
const BUNDLED = path.join(SKILL_DIR, 'dopl-channel-wait.sh');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');

test('the bundled hold script is byte-identical to scripts/dopl-channel-wait.sh', () => {
  const canonical = fs.readFileSync(CANONICAL, 'utf8');
  const bundled = fs.readFileSync(BUNDLED, 'utf8');
  assert.equal(
    bundled,
    canonical,
    'the shipped copy has drifted from the canonical script — copy scripts/dopl-channel-wait.sh over dopl-desktop-app/main/runtime/claude/skills/dopl-channels-wait/dopl-channel-wait.sh in the same commit',
  );
});

test('the script takes no secret on its command line', () => {
  const src = fs.readFileSync(CANONICAL, 'utf8');
  // ⚠ A token on a command line is readable by every process via `ps` and
  // lands in shell history; one in a URL lands in server logs and proxy
  // history. Both are asserted as ABSENCES because both are one convenience
  // edit away.
  assert.ok(!/--token/.test(src), 'the script must not accept a --token argument');
  assert.ok(!/token=\$\{?TOKEN/.test(src), 'the token must never be spliced into a URL');
  assert.ok(/Authorization: Bearer/.test(src), 'the token rides a header');
});

test('the skill states what the server actually does', () => {
  const md = fs.readFileSync(SKILL_MD, 'utf8');
  // ⚠ Frontmatter shape, matching the other dopl-* skills.
  assert.match(md, /^---\nname: dopl-channels-wait\n/);
  assert.match(md, /^description: >-$/m);
  assert.match(md, /^version: \d+\.\d+\.\d+$/m);
  // The three server-side facts it asserts. Each is checked against the MCP
  // tree's own constants by that package's suites; here we only pin that the
  // skill has not started claiming something else.
  assert.ok(md.includes('dopl://doctrine/channels'), 'names the canonical rule');
  assert.ok(md.includes('reason=POLLING_DETECTED'), 'names the refusal the server can return');
  assert.ok(
    md.includes('desktop-run session may not hold'),
    'states the one runtime where holding is refused outright',
  );
  // ⚠ The exit codes are the whole contract of a background task — a skill that
  // taught the wrong ones would have every session mis-read its own wake.
  for (const code of ['Exit **0**', 'Exit **3**', 'Exit **2**']) {
    assert.ok(md.includes(code), `the skill must state ${code}`);
  }
});

test('the skill never tells a session to re-read on a timer', () => {
  const md = fs.readFileSync(SKILL_MD, 'utf8').toLowerCase();
  // ⚠ THE ONE THING THIS SKILL EXISTS TO PREVENT, asserted as an absence over
  // its own text. `sleep` in a loop is the shape; a mention of "poll" is fine
  // (the skill names the thing it is replacing) but a `sleep` is not.
  assert.ok(!/\bsleep \d/.test(md), 'no sleep-and-retry loop may appear in the skill');
  assert.ok(md.includes('never a timed poll') || md.includes('not a poll'));
});
