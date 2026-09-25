// The Ask / Auto / Full level model: each runtime's table, the ordering reads, and registration.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const registry = require('../main/runtime');
const pl = require('../main/runtime/permission-level.js');

const d = (id) => registry.descriptorFor(id);
const pair = (id, level) => {
  const s = pl.levelSettings(d(id), level);
  return pl.settingText(d(id), s.tools, s.native);
};

describe('each runtime maps the three levels onto its own settings', () => {
  test('claude: manual / auto / bypass', () => {
    assert.deepEqual(pl.LEVELS.map((l) => pair('claude', l)), ['manual', 'auto', 'bypass']);
  });
  test('codex: the Codex app presets (Ask for approval, and Full access = never + danger-full-access)', () => {
    assert.equal(pair('codex', 'ask'), 'on-request/workspace-write');
    assert.equal(pl.levelSettings(d('codex'), 'ask').label, 'Ask for approval');
    assert.equal(pair('codex', 'full'), 'never/danger-full-access');
    assert.equal(pl.levelSettings(d('codex'), 'full').label, 'Full access');
  });
  test('codex Auto runs Ask\'s pair (auto_review is withheld: it bypasses Dopl\'s gate)', () => {
    assert.equal(pair('codex', 'auto'), pair('codex', 'ask'));
    assert.equal(JSON.stringify(pl.levelSettings(d('codex'), 'auto').native).includes('review'), false);
  });
  test('cursor: allowlist / auto-review / run-everything', () => {
    assert.deepEqual(pl.LEVELS.map((l) => pair('cursor', l)), ['allowlist', 'auto-review', 'run-everything']);
  });
  test('an unknown level reads as Ask', () => {
    for (const id of registry.ids()) assert.deepEqual(pl.levelSettings(d(id), 'yolo'), pl.levelSettings(d(id), 'ask'));
  });
});

describe('levelOf — the widest level a native pair meets on every axis', () => {
  test('claude: accept_edits is Ask, auto is Auto, bypass is Full', () => {
    assert.equal(pl.levelOf(d('claude'), 'manual'), 'ask');
    assert.equal(pl.levelOf(d('claude'), 'accept_edits'), 'ask');
    assert.equal(pl.levelOf(d('claude'), 'auto'), 'auto');
    assert.equal(pl.levelOf(d('claude'), 'bypass'), 'full');
  });
  test('codex: Full needs BOTH never and danger-full-access', () => {
    assert.equal(pl.levelOf(d('codex'), 'untrusted'), 'ask');
    assert.equal(pl.levelOf(d('codex'), 'never', { sandbox_mode: 'workspace-write' }), 'auto');
    assert.equal(pl.levelOf(d('codex'), 'never'), 'auto'); // absent sandbox = workspace-write
    assert.equal(pl.levelOf(d('codex'), 'on-request', { sandbox_mode: 'danger-full-access' }), 'auto');
    assert.equal(pl.levelOf(d('codex'), 'never', { sandbox_mode: 'danger-full-access' }), 'full');
  });
  test('an unrecognised word fails closed to Ask', () => {
    for (const id of registry.ids()) assert.equal(pl.levelOf(d(id), 'nonsense'), 'ask');
  });
  test('round trip: every level reads back as itself or a level with the same settings', () => {
    for (const id of registry.ids()) {
      for (const l of pl.LEVELS) {
        const s = pl.levelSettings(d(id), l);
        assert.equal(pair(id, pl.levelOf(d(id), s.tools, s.native)), pair(id, l), `${id}/${l}`);
      }
    }
  });
});

describe('toolWordFor — a level or a native word, in the runtime\'s terms', () => {
  test('a level becomes that runtime\'s tool mode', () => {
    assert.equal(pl.toolWordFor(d('codex'), 'full'), 'never');
    assert.equal(pl.toolWordFor(d('claude'), 'full'), 'bypass');
    assert.equal(pl.toolWordFor(d('cursor'), 'ask'), 'allowlist');
  });
  test('a native word stays itself; another runtime\'s word is not applied', () => {
    assert.equal(pl.toolWordFor(d('codex'), 'granular'), 'granular');
    assert.equal(pl.toolWordFor(d('codex'), 'bypass'), '');
  });
  test('"auto" is the level on every runtime (on Claude it is also the native word, same meaning)', () => {
    assert.equal(pl.toolWordFor(d('claude'), 'auto'), 'auto');
    assert.equal(pl.toolWordFor(d('cursor'), 'auto'), 'auto-review');
  });
});

describe('levelProblems — a malformed table refuses registration', () => {
  const base = d('codex');
  const withLevels = (levels) => ({ ...base, toolMode: { ...base.toolMode, levels } });
  test('the registered adapters have none', () => {
    for (const id of registry.ids()) assert.deepEqual(pl.levelProblems(d(id)), []);
  });
  test('a missing level, an undeclared word, an undeclared native value, a narrowing order', () => {
    const ok = base.toolMode.levels;
    assert.match(pl.levelProblems(withLevels({ ask: ok.ask, auto: ok.auto })).join(), /levels\.full is missing/);
    assert.match(pl.levelProblems(withLevels({ ...ok, full: { tools: 'bypass' } })).join(), /not a declared tool mode/);
    assert.match(pl.levelProblems(withLevels({ ...ok, full: { tools: 'never', native: { sandbox_mode: 'yolo' } } })).join(), /containment value/);
    assert.match(pl.levelProblems(withLevels({ ...ok, full: { tools: 'untrusted', label: 'x' } })).join(), /narrower than the level below/);
  });
});
