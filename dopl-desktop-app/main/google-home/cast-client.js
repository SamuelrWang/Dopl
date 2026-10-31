// A minimal Google Cast v2 sender: TLS to the device's port 8009, the connection/heartbeat
// handshake, LAUNCH of the Default Media Receiver, then one media LOAD. Everything Dopl needs to
// speak on a Google Home / Nest speaker or put a card on a Nest Hub over the LAN, with no Google
// account, no OAuth and no app registration (the Default Media Receiver is public).
//
// ⚠ Cast devices present a self-signed certificate, so `rejectUnauthorized: false` is the protocol,
// not a shortcut: every sender (Chrome, pychromecast, castv2) connects this way. The connection never
// leaves the LAN and carries no credential.

const tls = require('tls');
const { encodeFrame, createFrameReader } = require('./cast-frame');

const NS = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
};
const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';
const SENDER = 'sender-0';
const RECEIVER = 'receiver-0';
const HEARTBEAT_MS = 5000;

/** One open Cast channel. `connect` is the seam tests use to drive a fake socket. */
function openCastChannel({ host, port = 8009, timeoutMs = 10000, connect }) {
  const dial = connect || ((opts, onReady) => tls.connect(opts, onReady));
  return new Promise((resolve, reject) => {
    let settled = false;
    let nextId = 1;
    const waiters = new Map(); // requestId -> {resolve, reject, timer}
    let heartbeat = null;

    const fail = (err) => {
      for (const w of waiters.values()) { clearTimeout(w.timer); w.reject(err); }
      waiters.clear();
      clearInterval(heartbeat);
      if (!settled) { settled = true; reject(err); }
    };

    // Deferred a tick so a connector that calls back synchronously still finds `socket` and `channel`.
    const socket = dial({ host, port, rejectUnauthorized: false, timeout: timeoutMs }, () => setImmediate(() => {
      if (settled) return;
      settled = true;
      heartbeat = setInterval(() => send(NS.heartbeat, RECEIVER, { type: 'PING' }), HEARTBEAT_MS);
      send(NS.connection, RECEIVER, { type: 'CONNECT' });
      resolve(channel);
    }));

    const send = (namespace, destinationId, data) => {
      socket.write(encodeFrame({ sourceId: SENDER, destinationId, namespace, data }));
    };

    const read = createFrameReader((msg) => {
      const data = msg.data || {};
      if (msg.namespace === NS.heartbeat && data.type === 'PING') {
        send(NS.heartbeat, msg.sourceId, { type: 'PONG' });
        return;
      }
      if (msg.namespace === NS.connection && data.type === 'CLOSE') {
        fail(new Error(`cast: ${msg.sourceId} closed the connection`));
        return;
      }
      const w = data.requestId !== undefined ? waiters.get(data.requestId) : null;
      if (w) { waiters.delete(data.requestId); clearTimeout(w.timer); w.resolve(data); }
    });

    socket.on('data', (chunk) => { try { read(chunk); } catch (err) { fail(err); close(); } });
    socket.on('error', (err) => fail(err));
    socket.on('timeout', () => { fail(new Error(`cast: ${host}:${port} timed out`)); close(); });
    socket.on('close', () => fail(new Error('cast: connection closed')));

    /** Send with a fresh requestId and wait for the reply that echoes it. */
    const request = (namespace, destinationId, data, waitMs = timeoutMs) => new Promise((res, rej) => {
      const requestId = nextId++;
      const timer = setTimeout(() => { waiters.delete(requestId); rej(new Error(`cast: no reply to ${data.type}`)); }, waitMs);
      waiters.set(requestId, { resolve: res, reject: rej, timer });
      send(namespace, destinationId, { ...data, requestId });
    });

    const close = () => {
      clearInterval(heartbeat);
      try { socket.end(); } catch (_) { /* already closed */ }
    };

    const channel = { send, request, close };
  });
}

/** Run `use(channel)` on a fresh channel to `target`, which is always closed afterwards. */
async function withCastChannel(target, { connect, timeoutMs } = {}, use) {
  const channel = await openCastChannel({ host: target.host, port: target.port, connect, timeoutMs });
  try {
    return await use(channel);
  } finally {
    channel.close();
  }
}

/** The running Default Media Receiver's transport, launching it if needed. */
async function launchMediaReceiver(channel) {
  const status = await channel.request(NS.receiver, RECEIVER, { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER });
  if (status.type === 'LAUNCH_ERROR') throw new Error(`cast: launch refused (${status.reason || 'unknown'})`);
  const apps = (status.status && status.status.applications) || [];
  const app = apps.find((a) => a.appId === DEFAULT_MEDIA_RECEIVER);
  if (!app || !app.transportId) throw new Error('cast: the media receiver did not start');
  channel.send(NS.connection, app.transportId, { type: 'CONNECT' });
  return { transportId: app.transportId, sessionId: app.sessionId };
}

const LOAD_FAILURES = new Set(['LOAD_FAILED', 'LOAD_CANCELLED', 'INVALID_REQUEST', 'INVALID_PLAYER_STATE']);

/**
 * Cast one media item: `{url, contentType, title?, subtitle?, imageUrl?}`. Resolves once the
 * device accepted the LOAD (it then plays on its own; the sender may hang up).
 */
function castMedia(target, media, options) {
  return withCastChannel(target, options, async (channel) => {
    const { transportId, sessionId } = await launchMediaReceiver(channel);
    const metadata = { metadataType: 0, title: media.title || 'Dopl' };
    if (media.subtitle) metadata.subtitle = media.subtitle;
    if (media.imageUrl) metadata.images = [{ url: media.imageUrl }];
    const reply = await channel.request(NS.media, transportId, {
      type: 'LOAD',
      sessionId,
      autoplay: true,
      media: { contentId: media.url, contentType: media.contentType, streamType: 'BUFFERED', metadata },
    });
    if (LOAD_FAILURES.has(reply.type)) throw new Error(`cast: device refused the media (${reply.type}${reply.reason ? `: ${reply.reason}` : ''})`);
    const first = Array.isArray(reply.status) ? reply.status[0] : null;
    return { mediaSessionId: first ? first.mediaSessionId : null, playerState: first ? first.playerState : null };
  });
}

module.exports = { withCastChannel, castMedia, NS, RECEIVER, DEFAULT_MEDIA_RECEIVER };
