// Google Home service + MCP tools with every network effect stubbed: discovery returns fixed rows,
// `cast` records what would have been sent, speech/cards return fake files, the media server is a
// recorder. Nothing here can reach a real speaker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGoogleHome } = require('../main/google-home/service.js');
const { registerGoogleHomeTools, TOOL_NAMES } = require('../main/google-home/mcp-tools.js');

const SPEAKER = { id: 's1', name: 'Office speaker', model: 'Google Home', host: '10.0.0.2', port: 8009, display: false, group: false };
const HUB = { id: 'h1', name: 'Kitchen display', model: 'Google Nest Hub', host: '10.0.0.3', port: 8009, display: true, group: false };
const GROUP = { id: 'g1', name: 'Everywhere', model: 'Google Cast Group', host: '10.0.0.2', port: 32187, display: false, group: true };

function harness(devices = [SPEAKER, HUB, GROUP]) {
  const casts = [];
  const published = [];
  let scans = 0;
  const home = createGoogleHome({
    discover: async () => { scans += 1; return devices; },
    cast: async (target, media) => { casts.push({ target, media }); return { mediaSessionId: 1, playerState: 'BUFFERING' }; },
    speak: async (text, opts) => ({ file: `/tmp/speech.m4a`, contentType: 'audio/mp4', text, opts }),
    card: async (card) => ({ file: `/tmp/card.png`, contentType: 'image/png', card }),
    media: { publish: async (file, type, host) => { published.push({ file, type, host }); return `http://lan/${file.split('/').pop()}`; }, close: () => {} },
  });
  return { home, casts, published, scans: () => scans };
}

test('status lists devices without hosts; capabilities marks ask unsupported', async () => {
  const { home } = harness();
  const s = await home.status();
  assert.equal(s.online, true);
  assert.equal(s.count, 3);
  assert.deepEqual(Object.keys(s.devices[0]).sort(), ['display', 'group', 'id', 'model', 'name']);
  const c = home.capabilities();
  assert.equal(c.ask.supported, false);
  assert.equal(c.notify.supported, true);
  assert.equal(c.show.supported, true);
});

test('notify speaks text on the named device and serves the audio to that device', async () => {
  const { home, casts, published } = harness();
  const r = await home.notify({ text: 'Build finished', device: 'office speaker', voice: 'Samantha' });
  assert.equal(r.ok, true);
  assert.equal(r.device.id, 's1');
  assert.deepEqual(published, [{ file: '/tmp/speech.m4a', type: 'audio/mp4', host: '10.0.0.2' }]);
  assert.equal(casts[0].target.host, '10.0.0.2');
  assert.equal(casts[0].media.url, 'http://lan/speech.m4a');
  assert.equal(casts[0].media.contentType, 'audio/mp4');
  assert.equal(casts[0].media.subtitle, 'Build finished');
});

test('notify needs a device when several are found, and plays audio_url without synthesis', async () => {
  const { home, casts, published } = harness();
  await assert.rejects(home.notify({ text: 'hi' }), /Several devices found; pass device. Found: Office speaker, Kitchen display \(screen\)/);
  await home.notify({ device: 's1', audio_url: 'https://example.com/chime.mp3' });
  assert.equal(published.length, 0);
  assert.equal(casts[0].media.url, 'https://example.com/chime.mp3');
  assert.equal(casts[0].media.contentType, 'audio/mpeg');
  await assert.rejects(home.notify({ device: 's1', audio_url: 'file:///etc/passwd' }), /http\(s\)/);
});

test('with one speaker on the network, device may be omitted; groups never count', async () => {
  const { home, casts } = harness([SPEAKER, GROUP]);
  await home.notify({ text: 'hello' });
  assert.equal(casts[0].target.id, 's1');
});

test('notify validates text length and reports an empty network plainly', async () => {
  const { home } = harness();
  await assert.rejects(home.notify({ device: 's1', text: 'x'.repeat(501) }), /max 500/);
  await assert.rejects(home.notify({ device: 's1' }), /text is required/);
  const empty = harness([]);
  await assert.rejects(empty.home.notify({ text: 'hi' }), /No Google Home found/);
});

test('an unknown device triggers one rescan before refusing', async () => {
  const h = harness();
  await h.home.status();
  const before = h.scans();
  await assert.rejects(h.home.notify({ text: 'hi', device: 'garage' }), /No device "garage"/);
  assert.equal(h.scans(), before + 1);
});

test('show renders a card for the one Nest Hub and casts it as an image', async () => {
  const { home, casts, published } = harness();
  const r = await home.show({ title: 'Flight UA 212', lines: ['Gate B14', 'Boards 9:40'] });
  assert.equal(r.device.id, 'h1');
  assert.equal(published[0].type, 'image/png');
  assert.equal(published[0].host, '10.0.0.3');
  assert.equal(casts[0].media.contentType, 'image/png');
  assert.equal(casts[0].media.subtitle, 'Gate B14 · Boards 9:40');
});

test('show with speak plays speech with the card as artwork; a speaker is refused', async () => {
  const { home, casts } = harness();
  await home.show({ title: 'Done', lines: ['All green'], speak: true });
  assert.equal(casts[0].media.contentType, 'audio/mp4');
  assert.equal(casts[0].media.imageUrl, 'http://lan/card.png');
  await assert.rejects(home.show({ title: 'x', device: 's1' }), /has no screen; use google_home_notify/);
  await assert.rejects(home.show({ title: 'x', lines: Array(7).fill('a') }), /max 6/);
});

test('show with image_url casts it with the type its extension names', async () => {
  const { home, casts, published } = harness();
  await home.show({ title: 'Map', image_url: 'https://example.com/m.jpg' });
  assert.equal(published.length, 0);
  assert.equal(casts[0].media.contentType, 'image/jpeg');
});

function fakeServer() {
  const tools = new Map();
  return { tools, registerTool: (name, def, handler) => tools.set(name, { def, handler }) };
}

test('MCP: the four google_home_* tools, no ask; results are one JSON text block, refusals isError', async () => {
  const server = fakeServer();
  const { home } = harness();
  registerGoogleHomeTools(server, home);
  assert.deepEqual([...server.tools.keys()], TOOL_NAMES);
  assert.ok(!server.tools.has('google_home_ask'));
  const ok = await server.tools.get('google_home_notify').handler({ text: 'hi', device: 's1' });
  assert.equal(ok.isError, undefined);
  assert.equal(JSON.parse(ok.content[0].text).device.name, 'Office speaker');
  const bad = await server.tools.get('google_home_show').handler({ title: 'x', device: 's1' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /no screen/);
  const caps = JSON.parse((await server.tools.get('google_home_capabilities').handler({})).content[0].text);
  assert.equal(caps.ask.supported, false);
});

test('MCP: the tools register on a real McpServer (zod schemas accepted)', () => {
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const server = new McpServer({ name: 't', version: '0' });
  registerGoogleHomeTools(server, harness().home);
});
