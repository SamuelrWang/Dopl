// Serves the speech and card files a Google Home fetches. A Cast device pulls media by URL, so the
// file must be reachable from the LAN for as long as the device reads it. Each file gets an
// unguessable one-off path and is deleted after `ttlMs`; any other path is a 404. Nothing is
// served before the first publish (the server starts lazily) and nothing outlives the process.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_TTL_MS = 5 * 60 * 1000;

const toInt = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);

/**
 * The address the device can reach us on: the IPv4 interface on the device's own subnet when one
 * matches, else the first non-internal IPv4.
 */
function lanAddress(deviceHost, interfaces = os.networkInterfaces()) {
  const v4 = Object.values(interfaces).flat().filter((i) => i && (i.family === 'IPv4' || i.family === 4) && !i.internal);
  if (deviceHost && /^\d+\.\d+\.\d+\.\d+$/.test(deviceHost)) {
    const target = toInt(deviceHost);
    const same = v4.find((i) => i.netmask && (toInt(i.address) & toInt(i.netmask)) === (target & toInt(i.netmask)));
    if (same) return same.address;
  }
  if (!v4.length) throw new Error('No LAN address: connect this computer to the same network as the speaker.');
  return v4[0].address;
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m) return null;
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] === '' || m[2] === '' ? size - 1 : Number(m[2]);
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  return start <= end ? { start, end } : null;
}

function createMediaServer({ ttlMs = DEFAULT_TTL_MS, interfaces } = {}) {
  const files = new Map(); // token -> {file, contentType, timer}
  let listening = null; // Promise<http.Server>, shared so concurrent publishes start one server

  const handle = (req, res) => {
    const token = (req.url || '').split('/')[1] || '';
    const entry = files.get(token);
    if (!entry || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404).end(); return; }
    let size;
    try { size = fs.statSync(entry.file).size; } catch (_) { res.writeHead(404).end(); return; }
    const range = parseRange(req.headers.range, size);
    res.writeHead(range ? 206 : 200, {
      'Content-Type': entry.contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': range ? range.end - range.start + 1 : size,
      ...(range && { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` }),
    });
    if (req.method === 'HEAD') { res.end(); return; }
    // The file can expire between the stat and the open; an unheard stream error would end the process.
    fs.createReadStream(entry.file, range || undefined).on('error', () => res.destroy()).pipe(res);
  };

  const listen = () => (listening ??= new Promise((resolve, reject) => {
    const server = http.createServer(handle);
    server.once('error', (err) => { listening = null; reject(err); });
    server.listen(0, '0.0.0.0', () => resolve(server));
  }));

  const drop = (token) => {
    const entry = files.get(token);
    if (!entry) return;
    clearTimeout(entry.timer);
    files.delete(token);
    fs.rmSync(entry.file, { force: true });
  };

  /** Publish a local file for one device; returns the URL to cast. The file is deleted at expiry. */
  async function publish(file, contentType, deviceHost) {
    const { port } = (await listen()).address();
    const token = crypto.randomBytes(16).toString('hex');
    const timer = setTimeout(() => drop(token), ttlMs);
    timer.unref();
    files.set(token, { file, contentType, timer });
    return `http://${lanAddress(deviceHost, interfaces)}:${port}/${token}/${path.basename(file)}`;
  }

  function close() {
    for (const token of [...files.keys()]) drop(token);
    if (listening) listening.then((server) => server.close(), () => {});
    listening = null;
  }

  return { publish, close };
}

module.exports = { createMediaServer, lanAddress, parseRange };
