// The Cast bridge's loop against a fake server and a fake speaker. Nothing here reaches a network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createClient, pass, readConfig, run } = require('../main/google-home/bridge.js');

const fakeClient = (batches) => {
  const acks = [];
  const polls = [];
  return {
    acks,
    polls,
    poll: async (identity) => { polls.push(identity); return { messages: batches.shift() ?? [] }; },
    ack: async (a) => { acks.push(a); return { ok: true }; },
  };
};

test('a cast is acked ok, a failed cast is acked with its reason, and both are finished', async () => {
  const client = fakeClient([[{ id: 'b', text: 'boom' }, { id: 'a', text: 'hello' }]]);
  const spoken = [];
  const home = { notify: async ({ text }) => { if (text === 'boom') throw new Error('speaker gone'); spoken.push(text); return {}; } };
  await pass({ client, home, identity: {}, log: () => {} });
  assert.deepEqual(spoken, ['hello']);
  assert.deepEqual(client.acks, [{ id: 'b', ok: false, error: 'speaker gone' }, { id: 'a', ok: true }]);
});

test('a lost ack is sent again and the speaker does not repeat itself', async () => {
  const m = { id: 'a', text: 'hello' };
  const client = fakeClient([[m], [m]]);
  const realAck = client.ack;
  client.ack = async (a) => { client.ack = realAck; throw Object.assign(new Error('down'), { status: 500 }); };
  const spoken = [];
  const home = { notify: async ({ text }) => { spoken.push(text); return {}; } };
  const state = { unacked: new Map(), busyUntil: 0 };
  await assert.rejects(() => pass({ client, home, identity: {}, log: () => {}, state }));
  await pass({ client, home, identity: {}, log: () => {}, state });
  assert.deepEqual(spoken, ['hello']);
  assert.deepEqual(client.acks, [{ id: 'a', ok: true }]);
});

test('an ack answered 404 is finished, not an outage', async () => {
  const client = fakeClient([[{ id: 'a', text: 'one' }]]);
  client.ack = async () => { throw Object.assign(new Error('gone'), { status: 404 }); };
  const state = { unacked: new Map(), busyUntil: 0 };
  await pass({ client, home: { notify: async () => ({}) }, identity: {}, log: () => {}, state });
  assert.equal(state.unacked.size, 0);
});

test('a message waits for the one still speaking, and polls keep coming', async () => {
  const client = fakeClient([[{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }], [{ id: 'b', text: 'two' }], [{ id: 'b', text: 'two' }]]);
  const spoken = [];
  const home = { notify: async ({ text }) => { spoken.push(text); return {}; } };
  const state = { unacked: new Map(), busyUntil: 0 };
  let t = 0;
  const go = () => pass({ client, home, identity: {}, log: () => {}, state, now: () => t });
  await go();
  assert.deepEqual(spoken, ['one']);
  t = 3000;
  await go();
  assert.deepEqual(spoken, ['one']);
  t = 8000;
  await go();
  assert.deepEqual(spoken, ['one', 'two']);
  assert.equal(client.polls.length, 3);
});

test('the config must be private, parseable and https', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bridge-'));
  const file = path.join(dir, 'c.json');
  const write = (body, mode) => { writeFileSync(file, body); chmodSync(file, mode); };
  write(JSON.stringify({ apiUrl: 'https://x.test/', token: 't' }), 0o600);
  assert.deepEqual(readConfig(file), { apiUrl: 'https://x.test', token: 't' });
  chmodSync(file, 0o644);
  assert.throws(() => readConfig(file), /chmod 600/);
  write(JSON.stringify({ apiUrl: 'http://x.test', token: 't' }), 0o600);
  assert.throws(() => readConfig(file), /must be https/);
  write(JSON.stringify({ apiUrl: 'http://localhost:3000', token: 't' }), 0o600);
  assert.equal(readConfig(file).apiUrl, 'http://localhost:3000');
  write('{"token":"secret', 0o600);
  assert.throws(() => readConfig(file), (err) => !err.message.includes('secret'));
  rmSync(dir, { recursive: true });
});

test('the client sends the bearer, and a refusal carries its status', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push([url, init.headers.authorization]); return { ok: false, status: 404 }; };
  const client = createClient({ apiUrl: 'https://x.test', token: 'tok', fetchImpl });
  await assert.rejects(() => client.poll({}), (err) => err.status === 404);
  assert.deepEqual(seen, [['https://x.test/api/device-bridge/poll', 'Bearer tok']]);
});

test('run reports the speaker once, survives a server error and says each problem once', async () => {
  const lines = [];
  let turns = 0;
  const client = fakeClient([[], [], []]);
  const poll = client.poll;
  client.poll = async (identity) => {
    turns += 1;
    if (turns === 2 || turns === 3) throw Object.assign(new Error('nope'), { status: 404 });
    return poll(identity);
  };
  const home = { status: async () => ({ devices: [{ id: '1', name: 'Kitchen', model: 'Google Home', group: false }] }), notify: async () => ({}) };
  await run({ client, home, log: (l) => lines.push(l), sleep: async () => {}, stop: () => turns >= 5, now: () => 0 });
  assert.deepEqual(client.polls[0], { name: 'Kitchen', model: 'Google Home' });
  assert.deepEqual(client.polls[1], {});
  assert.equal(lines.filter((l) => /not deployed/.test(l)).length, 1);
  assert.ok(lines.includes('Connected to Dopl again.'));
});

test('several speakers and no --device casts to nobody by name and asks', async () => {
  const lines = [];
  let turns = 0;
  const client = { poll: async () => { turns += 1; return { messages: [] }; }, ack: async () => ({}) };
  const home = { status: async () => ({ devices: [{ id: '1', name: 'A', model: 'm', group: false }, { id: '2', name: 'B', model: 'm', group: false }] }), notify: async () => ({}) };
  await run({ client, home, log: (l) => lines.push(l), sleep: async () => {}, stop: () => turns >= 1, now: () => 0 });
  assert.match(lines[0], /Found: A, B/);
});
