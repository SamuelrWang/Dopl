// Google Home device control (device_status / device_command): the Cast translator against a fake
// device that plays Spotify, and the service + tool layer with the translator stubbed. No real
// device is contacted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { encodeFrame, createFrameReader } = require('../main/google-home/cast-frame.js');
const { NS } = require('../main/google-home/cast-client.js');
const { readDeviceState, sendDeviceCommand, commandsFor, DeviceCommandError } = require('../main/google-home/device-control.js');
const { createGoogleHome } = require('../main/google-home/service.js');

const SPOTIFY = {
  appId: 'CC32E753', displayName: 'Spotify', statusText: 'Casting: Spotify', sessionId: 'sp-sess', transportId: 'sp-1',
  namespaces: [{ name: NS.media }],
};

/** A fake speaker. `app` null = idle; `media` is the media namespace's status row (or null = no reply). */
function fakeSpeaker({ app = SPOTIFY, media = { mediaSessionId: 9, playerState: 'PLAYING', supportedMediaCommands: 15, media: { metadata: { title: 'Song', artist: 'Band' } } } } = {}) {
  const sent = [];
  const state = { app, media, volume: { level: 0.6, muted: false } };
  const socket = new EventEmitter();
  const reply = (from, namespace, data) => setImmediate(() => socket.emit('data', encodeFrame({ sourceId: from, destinationId: 'sender-0', namespace, data })));
  const receiverStatus = (requestId) => ({
    type: 'RECEIVER_STATUS', requestId,
    status: { volume: state.volume, applications: state.app ? [state.app] : [{ appId: 'E8C28D3C', isIdleScreen: true }] },
  });
  const read = createFrameReader((m) => {
    sent.push(m);
    const d = m.data || {};
    if (m.namespace === NS.receiver) {
      if (d.type === 'SET_VOLUME') Object.assign(state.volume, d.volume);
      if (d.type === 'STOP') { state.app = null; state.media = null; }
      if (['GET_STATUS', 'SET_VOLUME', 'STOP'].includes(d.type)) reply('receiver-0', NS.receiver, receiverStatus(d.requestId));
    }
    if (m.namespace === NS.media) {
      if (d.type === 'PAUSE') state.media.playerState = 'PAUSED';
      if (d.type === 'PLAY') state.media.playerState = 'PLAYING';
      if (state.media) reply(m.destinationId, NS.media, { type: 'MEDIA_STATUS', requestId: d.requestId, status: [state.media] });
    }
  });
  socket.write = (buf) => read(buf);
  socket.end = () => {};
  const connect = (opts, onReady) => { onReady(); return socket; };
  return { connect, sent, state };
}

const TARGET = { id: 's1', name: 'Kitchen', host: '10.0.0.4', port: 8009 };
const names = (s) => s.commands.map((c) => c.name);

test('readDeviceState: the playing app, track, volume and the commands it accepts', async () => {
  const dev = fakeSpeaker();
  const s = await readDeviceState(TARGET, { connect: dev.connect });
  assert.deepEqual(s.playing, { app: 'Spotify', state: 'PLAYING', title: 'Song', artist: 'Band' });
  assert.deepEqual(s.volume, { level: 0.6, muted: false });
  assert.deepEqual(names(s), ['set_volume', 'mute', 'unmute', 'pause', 'stop']);
  assert.ok(!JSON.stringify(s).includes('sp-sess'), 'no session ids leak');
});

test('an idle speaker offers volume only; a paused one offers play', async () => {
  assert.deepEqual(names(await readDeviceState(TARGET, { connect: fakeSpeaker({ app: null, media: null }).connect })), ['set_volume', 'mute', 'unmute']);
  const paused = fakeSpeaker({ media: { mediaSessionId: 9, playerState: 'PAUSED', supportedMediaCommands: 15 } });
  assert.deepEqual(names(await readDeviceState(TARGET, { connect: paused.connect })), ['set_volume', 'mute', 'unmute', 'play', 'stop']);
});

test('an app that never answers the media namespace still reports and can be stopped', async () => {
  const dev = fakeSpeaker({ media: null });
  const s = await readDeviceState(TARGET, { connect: dev.connect, timeoutMs: 5000 });
  assert.deepEqual(s.playing, { app: 'Spotify', state: null, title: null, artist: null });
  assert.ok(names(s).includes('stop'));
  assert.ok(!names(s).includes('pause'));
});

test('stop sends receiver STOP for the running session; the state after shows nothing playing', async () => {
  const dev = fakeSpeaker();
  const after = await sendDeviceCommand(TARGET, 'stop', {}, { connect: dev.connect });
  const stop = dev.sent.find((m) => m.data && m.data.type === 'STOP');
  assert.equal(stop.data.sessionId, 'sp-sess');
  assert.equal(after.playing, null);
});

test('pause targets the media session; set_volume and mute go to the receiver', async () => {
  const dev = fakeSpeaker();
  const after = await sendDeviceCommand(TARGET, 'pause', {}, { connect: dev.connect });
  assert.equal(dev.sent.find((m) => m.data && m.data.type === 'PAUSE').data.mediaSessionId, 9);
  assert.equal(after.playing.state, 'PAUSED');
  const vol = await sendDeviceCommand(TARGET, 'set_volume', { level: 0.2 }, { connect: dev.connect });
  assert.equal(vol.volume.level, 0.2);
  assert.equal((await sendDeviceCommand(TARGET, 'mute', {}, { connect: dev.connect })).volume.muted, true);
});

test('a command the device does not list right now is refused with the list', async () => {
  const idle = fakeSpeaker({ app: null, media: null });
  await assert.rejects(sendDeviceCommand(TARGET, 'stop', {}, { connect: idle.connect }), (e) => e instanceof DeviceCommandError && /accepts: set_volume, mute, unmute/.test(e.message));
  await assert.rejects(sendDeviceCommand(TARGET, 'set_volume', { level: 3 }, { connect: fakeSpeaker().connect }), /0 to 1/);
});

test('commandsFor needs the pause bit before it offers pause', () => {
  assert.ok(!commandsFor({ app: {}, media: { state: 'PLAYING', canPause: false } }).some((c) => c.name === 'pause'));
});

// ── service layer ────────────────────────────────────────────────────────────

const SPEAKER = { id: 's1', name: 'Office speaker', model: 'Google Home', host: '10.0.0.2', port: 8009, display: false, group: false };
const HUB = { id: 'h1', name: 'Kitchen display', model: 'Google Nest Hub', host: '10.0.0.3', port: 8009, display: true, group: false };
const GROUP = { id: 'g1', name: 'Everywhere', model: 'Google Cast Group', host: '10.0.0.2', port: 32187, display: false, group: true };

function home({ state, control } = {}) {
  const calls = [];
  const h = createGoogleHome({
    discover: async () => [SPEAKER, HUB, GROUP],
    state: state || (async (d) => ({ playing: d.id === 'h1' ? { app: 'Spotify', state: 'PLAYING' } : null, volume: { level: 0.5, muted: false }, commands: [{ name: 'stop' }] })),
    control: control || (async (d, command, args) => { calls.push({ id: d.id, command, args }); return { playing: null, volume: { level: 0.5, muted: false }, commands: [] }; }),
    media: { publish: async () => 'http://lan/x', close: () => {} },
  });
  return { h, calls };
}

test('deviceStatus: every non-group device, tagged with its kind; an unreachable one reports, not throws', async () => {
  const { h } = home({ state: async (d) => { if (d.id === 's1') throw new Error('timed out'); return { playing: null, volume: {}, commands: [] }; } });
  const r = await h.deviceStatus();
  assert.equal(r.count, 2);
  assert.deepEqual(r.devices.map((d) => d.device.id), ['s1', 'h1']);
  assert.equal(r.devices[0].kind, 'google_home');
  assert.match(r.devices[0].error, /unreachable: timed out/);
});

test('deviceCommand: resolves the device by name, lowercases the command, passes args', async () => {
  const { h, calls } = home();
  const r = await h.deviceCommand({ device: 'kitchen display', command: 'STOP', args: { x: 1 } });
  assert.equal(r.ok, true);
  assert.equal(r.command, 'stop');
  assert.deepEqual(calls, [{ id: 'h1', command: 'stop', args: { x: 1 } }]);
  await assert.rejects(h.deviceCommand({ device: 'h1' }), /command is required/);
});

test('deviceCommand: a refused command surfaces as a fixable tool error', async () => {
  const { h } = home({ control: async () => { throw new DeviceCommandError('Kitchen display cannot pause right now. It accepts: stop'); } });
  await assert.rejects(h.deviceCommand({ device: 'h1', command: 'pause' }), /accepts: stop/);
  assert.equal(h.capabilities().device_control.supported, true);
});
