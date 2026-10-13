// **THE HOLD SCRIPT CARRIES ITS CURSOR VERBATIM** (B6, 2026-10-12).
//
// WHY THIS FILE EXISTS. `dopl-channel-wait.sh` read its cursor file through
// `tr -dc '0-9'` — keep the digits, drop everything else. Against the integer
// cursors that are the only kind anyone sends today that is invisible, and
// against the opaque `dc1.` cursors B6 introduces it is the worst available
// failure:
//
//   dc1.AbC-_123  ->  1123
//
// A perfectly valid seq, pointing somewhere nobody chose. The hold then runs
// from it and SAYS NOTHING — no error, no refusal, just a wait that replays
// messages or skips them. The same line turned a malformed file into whatever
// digits it happened to contain, so `junk-7-7` became the cursor `77`.
//
// ⚠ **THIS SCRIPT IS WHY THE FIX IS ITS OWN BRANCH.** It ships inside the
// desktop app, so a session only gets the fixed copy when a release carrying it
// is installed — which is why no server may hand out an opaque cursor until one
// is (B6-3 is held on exactly this). The repair has to be in a release BEFORE
// the thing it repairs exists.
//
// ⚠ **IT DRIVES THE REAL SCRIPT, BOTH COPIES, WITH A STUB `curl` ON PATH.** The
// assertion is what the script ASKED THE SERVER FOR — the `since=` it put in
// its own URL, and the headers it passed — because that is the only place the
// mangling was observable. No network, no server, no seam added to the script
// for the test's benefit.
//
// RED-BEFORE, measured against the pre-fix script by checking the two copies and
// SKILL.md out at 7aa490a8 and running this file as it stands: **15 of 21 fail,
// 6 pass.** (The commit that introduced this file says 14 — that was the count
// before the version-gate case was added, and it is wrong. The measured number
// lives here, where it can be re-derived, rather than only in a commit message.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');

/**
 * ⚠ BOTH COPIES, every case. `skill-assets-parity.test.mjs` already asserts the
 * two files are byte-identical, so this is belt and braces — and cheap enough
 * that the behaviour is pinned locally rather than inferred from another suite.
 */
const COPIES = {
  canonical: path.join(REPO, 'scripts', 'dopl-channel-wait.sh'),
  bundled: path.join(
    HERE,
    '..',
    'main',
    'runtime',
    'claude',
    'skills',
    'dopl-channels-wait',
    'dopl-channel-wait.sh',
  ),
};

/**
 * Run one copy of the hold script against a stub `curl`, and report what it
 * asked for.
 *
 * ⚠ The stub answers ONE page containing a match, so the script hits, writes
 * its cursor and exits 0 on the first lap. It REFUSES a second call, so a
 * mistaken expectation fails in a second instead of hanging the suite for the
 * script's thirty-minute budget.
 *
 * ⚠ `HOME` is the throwaway directory too: the script falls back to reading the
 * Claude CLI's config for a bearer token, and nothing here may touch the
 * operator's own. `DOPL_TOKEN` is set, so that path is not taken at all.
 */
const ONE_HIT =
  '{"messages":[{"seq":5,"body":"hi","authorUserId":"peer","channelSlug":"general"}]}';

function hold(script, { file, since, page = ONE_HIT } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dopl-wait-cursor-'));
  const log = path.join(dir, 'curl.argv');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'curl'),
    `#!/bin/sh\n` +
      `if [ -s '${log}' ]; then exit 7; fi\n` +
      `for a in "$@"; do printf '%s\\n' "$a" >> '${log}'; done\n` +
      `cat <<'JSON_EOF'\n${page}\nJSON_EOF\n`,
    { mode: 0o755 },
  );

  const cursorFile = file === undefined ? null : path.join(dir, 'cursor');
  if (file !== null && file !== undefined) fs.writeFileSync(cursorFile, file);

  const args = ['--container', 'c-1', '--max-minutes', '1'];
  if (cursorFile) args.push('--cursor-file', cursorFile);
  if (since !== undefined) args.push('--since', since);

  const res = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, DOPL_TOKEN: 't' },
  });

  const argv = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n')
    : [];
  const url = argv.find((a) => a.startsWith('http')) ?? '';
  return {
    status: res.status,
    stderr: res.stderr ?? '',
    stdout: res.stdout ?? '',
    url,
    /**
     * The header VALUES the script passed, in order. ⚠ Taken from the recorded
     * argv rather than parsed out of a formatted string, so a header can only
     * appear here if `curl` was actually handed it.
     */
    headers: argv.filter((a) => /^[A-Za-z-]+: /.test(a)),
    /** The `since=` the script actually sent, or null if it never asked. */
    requested: /[?&]since=([^&]*)/.exec(url)?.[1] ?? null,
    onDisk: cursorFile && fs.existsSync(cursorFile)
      ? fs.readFileSync(cursorFile, 'utf8')
      : null,
  };
}

test('🔒 the skill version moved, or no installed machine ever gets this fix', () => {
  // ⚠ **THE FIX IS INERT WITHOUT THIS.** `skill-install.js › installSkill`
  // short-circuits on `sidecar.version === version` and returns 'current'
  // WITHOUT WRITING ANYTHING — the version read off SKILL.md's frontmatter is
  // the only thing that decides whether the bundled `.sh` is copied over an
  // existing install. A machine holding the 1.2.0 sidecar would keep the
  // digit-stripping script forever, no matter how many releases shipped past
  // it, and the whole reason this repair is a branch of its own is that it has
  // to ARRIVE before the opaque cursors it handles do.
  const md = fs.readFileSync(
    path.join(path.dirname(COPIES.bundled), 'SKILL.md'),
    'utf8',
  );
  const version = /^version:\s*(\S+)\s*$/m.exec(md)?.[1];
  assert.ok(version, 'the skill must declare a version — `no-version` installs nothing');
  assert.notEqual(
    version,
    '1.2.0',
    'the digit-stripping cursor read shipped as 1.2.0; reusing that version means no upgrade',
  );
});

for (const [which, script] of Object.entries(COPIES)) {
  test(`[${which}] 🔒 an opaque cursor reaches the server CHARACTER FOR CHARACTER`, () => {
    // The regression case, named as the brief named it: this value became
    // `1123` — digits scraped out of a base64url body — and the hold ran from
    // there without a word.
    const r = hold(script, { file: 'dc1.AbC-_123\n' });
    assert.notEqual(
      r.requested,
      '1123',
      'the cursor was mangled into the digits it contains — `tr -dc` is back',
    );
    assert.equal(r.requested, 'dc1.AbC-_123');
    assert.equal(r.status, 0);
  });

  test(`[${which}] 🔒 and it needs no escaping on the way into the URL`, () => {
    // base64url plus the dot is already query-safe, which is why the token was
    // given that alphabet. Asserted because an escaping "fix" would break it.
    const r = hold(script, { file: 'dc1.AbC-_123\n' });
    assert.ok(
      r.url.includes('since=dc1.AbC-_123&'),
      `the token did not survive the query string: ${r.url}`,
    );
  });

  test(`[${which}] a legacy integer cursor is unchanged`, () => {
    // ⚠ THE CASE THAT MUST NOT MOVE. Every client sends an integer today and
    // will until a release changes that, so this is the compatibility
    // assertion, not the new feature.
    const r = hold(script, { file: '4461\n' });
    assert.equal(r.requested, '4461');
    assert.equal(r.status, 0);
  });

  test(`[${which}] --since takes both forms too`, () => {
    // One notion of "a cursor", two call sites: the file and the flag.
    assert.equal(hold(script, { since: '4461' }).requested, '4461');
    assert.equal(hold(script, { since: 'dc1.AbC-_123' }).requested, 'dc1.AbC-_123');
  });

  test(`[${which}] 🔒 a malformed --since is refused, and the value is NOT echoed`, () => {
    // ⚠ **THE SECOND HALF IS THE POINT, AND IT WAS UNASSERTED.** The refusal
    // deliberately does not quote the value back: `--since "$DOPL_TOKEN"` is a
    // plausible typo, and a message that echoed its argument would put a bearer
    // token on stderr — into the operator's terminal, their shell's scrollback,
    // and whatever captures a background task's output. This script's entire
    // posture is that no secret is ever echoed or passed as an argument, and a
    // helpful-looking `--since 'xyz' is not a cursor` would quietly break it.
    const r = hold(script, { since: 'junk-7-7' });
    assert.equal(r.status, 2);
    assert.equal(r.requested, null, 'no request may be made on an unreadable cursor');
    assert.ok(
      !r.stderr.includes('junk-7-7'),
      `the refusal echoed its own argument: ${r.stderr}`,
    );
    assert.match(r.stderr, /--since is not a cursor/);
  });

  test(`[${which}] 🔒 a malformed cursor file is REFUSED, never repaired`, () => {
    // ⚠ The sharp edge of the old line: this file has no cursor in it at all,
    // and `tr -dc '0-9'` INVENTED one — `77` — which the script then held from.
    const r = hold(script, { file: 'junk-7-7\n' });
    assert.notEqual(r.requested, '77', 'a cursor was fabricated from junk');
    assert.equal(r.requested, null, 'no request may be made on an unreadable cursor');
    assert.equal(r.status, 2);
  });

  test(`[${which}] 🔒 the refusal leaves the file exactly as it was`, () => {
    // ⚠ Two reasons, both load-bearing: an operator can see what went wrong,
    // and a cursor in a format THIS copy of the script is too old to recognise
    // is not destroyed by it. An old script meeting a new cursor must be inert,
    // not lossy.
    const r = hold(script, { file: 'junk-7-7\n' });
    assert.equal(r.onDisk, 'junk-7-7\n');
  });

  test(`[${which}] 🔒 and it carries the remedy rather than silently dropping the cursor`, () => {
    // ⚠ Holding with NO cursor is not the safe fallback it looks like: the
    // workspace hold answers a cursorless request with the newest N across
    // every channel (`repository-await-workspace.ts ›
    // listWorkspaceMessagesAfter`) — a firehose of already-seen messages read
    // as new. So the refusal has to tell the caller how to re-establish.
    const r = hold(script, { file: 'junk-7-7\n' });
    assert.match(r.stderr, /without one|unscoped/i);
    assert.match(r.stderr, /has NOT been changed/);
  });

  test(`[${which}] an EMPTY cursor file is "no cursor", not a malformed one`, () => {
    // The distinction the plan pins server-side as well: empty means absent,
    // which is a missing-argument error with its own message, not a corrupt
    // file. Both exit 2; only one of them accuses the file.
    const r = hold(script, { file: '' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no cursor/i);
    assert.equal(r.requested, null);
  });

  test(`[${which}] 🔒 a cursor in a format this script has never heard of is FORWARDED`, () => {
    // ⚠ DELIBERATELY PERMISSIVE. The prefix is also the key id, so a key
    // rotation mints `dc2.…`; a script that whitelisted `dc1.` would have to be
    // RELEASED again in lockstep — and this file ships inside the desktop app,
    // which is the slowest thing in the system to update. The server is the
    // authority on which cursors it can read, and it answers an unreadable one
    // with a 400 and its own reason, which `--fail-with-body` surfaces.
    assert.equal(hold(script, { file: 'dc2.AAAA\n' }).requested, 'dc2.AAAA');
  });

  test(`[${which}] 🔒 every request advertises that this client handles opaque cursors`, () => {
    // ⚠ **THIS HEADER IS THE CHECKABLE PRECONDITION FOR B6-3**, which is why it
    // ships in the same release as the verbatim read rather than with the thing
    // that needs it. "Has the fixed script been adopted?" has no answer a server
    // can act on: `skill-install.js` skips an install it finds `foreign` or
    // `edited` (:142, :144), so a digit-stripping copy can outlive any number of
    // releases and no version number anywhere would say so. A header turns that
    // into a property of the REQUEST — only a copy that reads verbatim sends it,
    // so a server can emit an opaque cursor to exactly those callers and keep
    // handing integers to everyone else.
    const r = hold(script, { file: '4461\n' });
    assert.ok(
      r.headers.includes('X-Dopl-Cursor: opaque-1'),
      `the capability header was not sent: ${JSON.stringify(r.headers)}`,
    );
  });

  test(`[${which}] 🔒 and it advertises it even when sending a legacy integer`, () => {
    // ⚠ It describes the CLIENT, not the cursor in hand. A script that only
    // advertised once it already held a token could never be given its first
    // one — the negotiation would deadlock on itself.
    assert.ok(hold(script, { since: '4461' }).headers.includes('X-Dopl-Cursor: opaque-1'));
    assert.ok(
      hold(script, { since: 'dc1.AbC-_123' }).headers.includes('X-Dopl-Cursor: opaque-1'),
    );
  });

  test(`[${which}] 🔒 a page-level cursor from the server is persisted VERBATIM`, () => {
    // ⚠ **THE OTHER HALF OF THE `X-Dopl-Cursor` PROMISE.** Advertising that this
    // client returns a cursor unchanged is worth nothing if the client then
    // computes its own instead — and it did: the next cursor came from
    // `max(row seq)`, so a token the server sent would have been ignored and an
    // integer sent back in its place. Reading the field means the day the server
    // starts emitting one, THIS script already consumes it, with no second
    // desktop release — and the desktop is the slowest thing here to update.
    const r = hold(script, {
      file: '4461\n',
      page:
        '{"cursor":"dc1.ZZtop-_99","messages":[{"seq":5,"body":"hi",' +
        '"authorUserId":"peer","channelSlug":"general"}]}',
    });
    assert.equal(r.onDisk, 'dc1.ZZtop-_99\n');
    assert.notEqual(r.onDisk, '5\n', 'the row seq was persisted over the page cursor');
    assert.equal(r.status, 0);
  });

  test(`[${which}] with no page cursor, the row-seq fallback is exactly as before`, () => {
    // ⚠ THE CASE THAT MUST NOT MOVE. Nothing emits the field today, so this is
    // what every real run does, and the change has to be invisible until a
    // server opts in.
    const r = hold(script, { file: '4461\n' });
    assert.equal(r.onDisk, '5\n');
    assert.equal(r.status, 0);
  });

  test(`[${which}] 🔒 a page cursor is persisted even when the page has NO messages`, () => {
    // ⚠ A cursor the server moved must be recorded even on an empty page, or the
    // next hold re-asks from behind it — and on a busy workspace that is a hold
    // that keeps being handed traffic it has already seen. The script writes it
    // and holds again; the stub refuses a second request, so the thing to assert
    // is the FILE, not the exit code.
    const r = hold(script, {
      file: '4461\n',
      page: '{"cursor":"dc1.EMPTY-_7","messages":[]}',
    });
    assert.equal(r.onDisk, 'dc1.EMPTY-_7\n');
  });

  test(`[${which}] a malformed page cursor degrades to the fallback, never fatally`, () => {
    // ⚠ Ignored rather than fatal, deliberately: persisting `str(whatever)` would
    // feed junk back as the next `since`, and failing the hold would turn one bad
    // field into an outage. The row-seq fallback is always valid.
    const r = hold(script, {
      file: '4461\n',
      page:
        '{"cursor":{"nope":1},"messages":[{"seq":5,"body":"hi",' +
        '"authorUserId":"peer","channelSlug":"general"}]}',
    });
    assert.equal(r.onDisk, '5\n');
    assert.equal(r.status, 0);
  });

  test(`[${which}] 🔒 the strips-no-characters promise the header makes is kept`, () => {
    // ⚠ An ABSENCE over the whole file, because the old line is one convenient
    // edit from coming back — and the next place it would land is `writeCursor`
    // or the `--since` arm rather than the file read.
    //
    // ⚠ FULL-LINE COMMENTS ARE REMOVED FIRST, and that is not a loophole: the
    // script's own docblock has to be free to NAME the defect it is preventing,
    // which is the one place `tr -dc` should still appear. A trailing comment is
    // left in scope, so the strip cannot be used to hide a live call.
    const code = fs
      .readFileSync(script, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    assert.ok(!/tr\s+-dc/.test(code), '`tr -dc` filters a cursor; it must not appear');
    assert.ok(!/tr\s+-d\b/.test(code), '`tr -d` filters a cursor; it must not appear');
    // And the strip really did leave the code behind — a filter that emptied the
    // file would make the two assertions above vacuous.
    assert.ok(code.includes('cursorOrEmpty'), 'the comment strip ate the code');
  });
}
