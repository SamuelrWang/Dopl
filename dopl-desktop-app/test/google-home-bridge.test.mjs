// The Cast bridge's loop against a fake server and a fake speaker. Nothing here reaches a network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient, pass, run } = require('../main/google-home/bridge.js');

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
  const client = fakeClient([[{ id: 'a', text: 'hello' }, { id: 'b', text: 'boom' }]]);
  const spoken = [];
  const home = { notify: async ({ text }) => { if (text === 'boom') throw new Error('speaker gone'); spoken.push(text); return {}; } };
  await pass({ client, home, identity: () => ({}), log: () => {} });
  assert.deepEqual(spoken, ['hello']);
  assert.deepEqual(client.acks, [{ id: 'a', ok: true }, { id: 'b', ok: false, error: 'speaker gone' }]);
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
