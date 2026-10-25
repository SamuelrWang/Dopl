// Google Home over Cast: the wire format, the sender handshake against a fake device, mDNS rows,
// the card renderer and the LAN file server. No real device is contacted: the socket is an
// in-memory fake and the only network use is the media server on 127.0.0.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { encodeFrame, decodeMessage, createFrameReader } = require('../main/google-home/cast-frame.js');
const { castMedia, NS, DEFAULT_MEDIA_RECEIVER } = require('../main/google-home/cast-client.js');
const { toDevice, discoverDevices } = require('../main/google-home/discovery.js');
const { cardSvg, wrap, synthesizeSpeech, renderCard } = require('../main/google-home/render.js');
const { createMediaServer, lanAddress, parseRange } = require('../main/google-home/media-server.js');

test('a CastMessage round-trips through the frame reader, split across chunks', () => {
  const frame = encodeFrame({ sourceId: 'sender-0', destinationId: 'receiver-0', namespace: NS.receiver, data: { type: 'LAUNCH', requestId: 7 } });
  assert.equal(frame.readUInt32BE(0), frame.length - 4);
  const got = [];
  const read = createFrameReader((m) => got.push(m));
  read(frame.subarray(0, 3));
  read(frame.subarray(3, 20));
  read(Buffer.concat([frame.subarray(20), frame]));
  assert.equal(got.length, 2);
  assert.deepEqual(got[0].data, { type: 'LAUNCH', requestId: 7 });
  assert.equal(got[0].namespace, NS.receiver);
  assert.equal(got[0].destinationId, 'receiver-0');
});

test('decode tolerates a non-JSON payload and refuses an oversized frame', () => {
  const body = encodeFrame({ sourceId: 'a', destinationId: 'b', namespace: 'n', data: 'not json' }).subarray(4);
  assert.equal(decodeMessage(body).data, null);
  const huge = Buffer.alloc(4);
  huge.writeUInt32BE(1 << 20, 0);
  assert.throws(() => createFrameReader(() => {})(huge), /exceeds/);
});

/** A fake Cast device: answers LAUNCH with a running Default Media Receiver and LOAD per `onLoad`. */
function fakeDevice({ onLoad = () => ({ type: 'MEDIA_STATUS', status: [{ mediaSessionId: 3, playerState: 'BUFFERING' }] }), launch } = {}) {
  const sent = [];
  const socket = new EventEmitter();
  const reply = (to, namespace, data) => socket.emit('data', encodeFrame({ sourceId: to, destinationId: 'sender-0', namespace, data }));
  const read = createFrameReader((m) => {
    sent.push(m);
    const d = m.data || {};
    if (d.type === 'LAUNCH') {
      setImmediate(() => reply('receiver-0', NS.receiver, launch ? { ...launch, requestId: d.requestId } : {
        type: 'RECEIVER_STATUS', requestId: d.requestId,
        status: { applications: [{ appId: DEFAULT_MEDIA_RECEIVER, transportId: 'web-1', sessionId: 'sess-1' }] },
      }));
    }
    if (d.type === 'LOAD') setImmediate(() => reply('web-1', NS.media, { ...onLoad(d), requestId: d.requestId }));
  });
  socket.write = (buf) => read(buf);
  socket.end = () => {};
  const connect = (opts, onReady) => { socket.opts = opts; onReady(); return socket; };
  return { connect, sent, socket };
}

test('castMedia: CONNECT, LAUNCH the Default Media Receiver, CONNECT its transport, LOAD with metadata', async () => {
  const dev = fakeDevice();
  const r = await castMedia({ host: '10.0.0.5', port: 8009 }, { url: 'http://10.0.0.2:1/x/a.m4a', contentType: 'audio/mp4', title: 'Dopl', subtitle: 'hi', imageUrl: 'http://10.0.0.2:1/y/c.png' }, { connect: dev.connect });
  assert.deepEqual(r, { mediaSessionId: 3, playerState: 'BUFFERING' });
  assert.equal(dev.socket.opts.rejectUnauthorized, false);
  const types = dev.sent.map((m) => `${m.destinationId}:${m.data.type}`);
  assert.deepEqual(types, ['receiver-0:CONNECT', 'receiver-0:LAUNCH', 'web-1:CONNECT', 'web-1:LOAD']);
  const load = dev.sent[3].data;
  assert.equal(load.sessionId, 'sess-1');
  assert.equal(load.media.contentId, 'http://10.0.0.2:1/x/a.m4a');
  assert.deepEqual(load.media.metadata, { metadataType: 0, title: 'Dopl', subtitle: 'hi', images: [{ url: 'http://10.0.0.2:1/y/c.png' }] });
});

test('castMedia surfaces a refused LOAD and a refused LAUNCH', async () => {
  await assert.rejects(
    castMedia({ host: 'h' }, { url: 'u', contentType: 'audio/mp4' }, { connect: fakeDevice({ onLoad: () => ({ type: 'LOAD_FAILED' }) }).connect }),
    /refused the media \(LOAD_FAILED/,
  );
  await assert.rejects(
    castMedia({ host: 'h' }, { url: 'u', contentType: 'audio/mp4' }, { connect: fakeDevice({ launch: { type: 'LAUNCH_ERROR', reason: 'NOT_ALLOWED' } }).connect }),
    /launch refused \(NOT_ALLOWED\)/,
  );
});

test('castMedia answers a device PING with PONG', async () => {
  const dev = fakeDevice();
  const origWrite = dev.socket.write;
  let pinged = false;
  dev.socket.write = (buf) => {
    origWrite(buf);
    if (!pinged) { pinged = true; setImmediate(() => dev.socket.emit('data', encodeFrame({ sourceId: 'receiver-0', destinationId: 'sender-0', namespace: NS.heartbeat, data: { type: 'PING' } }))); }
  };
  await castMedia({ host: 'h' }, { url: 'u', contentType: 'audio/mp4' }, { connect: dev.connect });
  assert.ok(dev.sent.some((m) => m.namespace === NS.heartbeat && m.data.type === 'PONG'));
});

test('toDevice reads the googlecast TXT record: name, model, screen bit, groups', () => {
  const hub = toDevice({ name: 'x', port: 8009, addresses: ['fe80::1', '192.168.1.20'], txt: { id: 'abc', fn: 'Kitchen display', md: 'Google Nest Hub', ca: '199173' } });
  assert.deepEqual(hub, { id: 'abc', name: 'Kitchen display', model: 'Google Nest Hub', host: '192.168.1.20', port: 8009, display: true, group: false });
  const mini = toDevice({ port: 8009, addresses: ['192.168.1.21'], txt: { id: 'def', fn: 'Bedroom', md: 'Google Nest Mini', ca: '199172' } });
  assert.equal(mini.display, false);
  const group = toDevice({ port: 32187, addresses: ['192.168.1.21'], txt: { id: 'g', fn: 'Everywhere', md: 'Google Cast Group', ca: '199173' } });
  assert.equal(group.group, true);
  assert.equal(group.display, false);
  assert.equal(toDevice({ txt: {} }), null);
});

test('discoverDevices de-duplicates by id and lists groups last', async () => {
  const answers = [
    { port: 1, addresses: ['10.0.0.3'], txt: { id: 'g', fn: 'All', md: 'Google Cast Group' } },
    { port: 1, addresses: ['10.0.0.2'], txt: { id: 'b', fn: 'Office', md: 'Google Home' } },
    { port: 1, addresses: ['10.0.0.2'], txt: { id: 'b', fn: 'Office', md: 'Google Home' } },
  ];
  let destroyed = false;
  const list = await discoverDevices({ timeoutMs: 5, browserFactory: () => ({ find: (cb) => answers.forEach(cb), destroy: () => { destroyed = true; } }) });
  assert.deepEqual(list.map((d) => d.id), ['b', 'g']);
  assert.ok(destroyed);
});

test('cardSvg escapes markup and wraps long lines', () => {
  const svg = cardSvg({ title: 'Deploy <done> & "ok"', lines: ['a '.repeat(80)] });
  assert.match(svg, /Deploy &lt;done&gt; &amp; &quot;ok&quot;/);
  assert.ok(!svg.includes('<done>'));
  assert.ok((svg.match(/font-size="40"/g) || []).length >= 3);
  assert.deepEqual(wrap('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
});

test('speech and card rendering call say / sips with a file path, never the text as an argument', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-test-'));
  const calls = [];
  const run = async (cmd, args) => { calls.push([cmd, args]); };
  const s = await synthesizeSpeech('-v evil', { voice: 'Samantha', run, dir, platform: 'darwin' });
  assert.equal(s.contentType, 'audio/mp4');
  assert.equal(calls[0][0], 'say');
  assert.deepEqual(calls[0][1].slice(0, 3), ['-v', 'Samantha', '-f']);
  assert.ok(!calls[0][1].includes('-v evil'));
  await renderCard({ title: 't' }, { run, dir, platform: 'darwin' });
  assert.equal(calls[1][0], 'sips');
  await assert.rejects(synthesizeSpeech('x', { run, dir, platform: 'linux' }), /macOS/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lanAddress picks the interface on the device subnet', () => {
  const ifaces = {
    lo0: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    utun: [{ family: 'IPv4', address: '10.8.0.2', netmask: '255.255.255.0', internal: false }],
    en0: [{ family: 'IPv4', address: '192.168.1.40', netmask: '255.255.255.0', internal: false }],
  };
  assert.equal(lanAddress('192.168.1.20', ifaces), '192.168.1.40');
  assert.equal(lanAddress(null, ifaces), '10.8.0.2');
  assert.throws(() => lanAddress('1.2.3.4', { lo0: ifaces.lo0 }), /No LAN address/);
  assert.deepEqual(parseRange('bytes=2-', 10), { start: 2, end: 9 });
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
});

const get = (url, headers = {}) => new Promise((resolve, reject) => {
  http.get(url, { headers }, (res) => { const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString(), headers: res.headers })); }).on('error', reject);
});

test('media server serves only published tokens, honours Range, and deletes files on close', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-test-'));
  const file = path.join(dir, 'a.m4a');
  fs.writeFileSync(file, '0123456789');
  const loopback = { lo0: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: false }] };
  const server = createMediaServer({ interfaces: loopback });
  const url = await server.publish(file, 'audio/mp4', '127.0.0.9');
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/a\.m4a$/);
  const full = await get(url);
  assert.equal(full.status, 200);
  assert.equal(full.body, '0123456789');
  assert.equal(full.headers['content-type'], 'audio/mp4');
  const part = await get(url, { Range: 'bytes=2-4' });
  assert.equal(part.status, 206);
  assert.equal(part.body, '234');
  const miss = await get(url.replace(/\/[0-9a-f]{32}\//, '/0000/'));
  assert.equal(miss.status, 404);
  server.close();
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
