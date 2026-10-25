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
  let server = null;
  let port = null;

  const handle = (req, res) => {
    const token = (req.url || '').split('/')[1] || '';
    const entry = files.get(token);
    if (!entry || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404).end(); return; }
    let size;
    try { size = fs.statSync(entry.file).size; } catch (_) { res.writeHead(404).end(); return; }
    const range = parseRange(req.headers.range, size);
    const headers = { 'Content-Type': entry.contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
    if (range) {
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': range.end - range.start + 1 });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(entry.file, range).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(entry.file).pipe(res);
  };

  const listen = () => new Promise((resolve, reject) => {
    if (server) { resolve(); return; }
    const s = http.createServer(handle);
    s.once('error', reject);
    s.listen(0, '0.0.0.0', () => { server = s; port = s.address().port; resolve(); });
  });

  const drop = (token) => {
    const entry = files.get(token);
    if (!entry) return;
    clearTimeout(entry.timer);
    files.delete(token);
    fs.rmSync(entry.file, { force: true });
  };

  /** Publish a local file for one device; returns the URL to cast. The file is deleted at expiry. */
  async function publish(file, contentType, deviceHost) {
    await listen();
    const token = crypto.randomBytes(16).toString('hex');
    const timer = setTimeout(() => drop(token), ttlMs);
    if (timer.unref) timer.unref();
    files.set(token, { file, contentType, timer });
    return `http://${lanAddress(deviceHost, interfaces)}:${port}/${token}/${path.basename(file)}`;
  }

  function close() {
    for (const token of [...files.keys()]) drop(token);
    if (server) server.close();
    server = null;
  }

  return { publish, close, size: () => files.size };
}

module.exports = { createMediaServer, lanAddress, parseRange };
