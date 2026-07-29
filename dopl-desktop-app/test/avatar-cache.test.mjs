// Tests for the v2.2 Session Window avatar pipeline (main/avatar-cache.js, Track T2,
// item 1/5/6) — the ONLY new remote-fetch surface.
//
// SOURCE EXTRACTION with INJECTION: the BEGIN/END AVATAR-CACHE-PURE block holds the
// bounded fetch+encode + the per-URL cache + the guards. It references ONLY Node
// globals (fetch, AbortSignal, Buffer, Map), so we slice it, prove it is
// electron/fs/require-free (§H-8), and inject a MOCK `fetch` — the guards below are
// exercised without a network, pinning the exact safety bounds the contract locks:
// https-only, image/* content-type, ≤256KB, data-uri assembly + cap, positive AND
// negative cache, and distinct self-vs-peer resolution.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "avatar-cache.js"), "utf8");

const BEGIN = "// ─── BEGIN AVATAR-CACHE-PURE";
const END = "// ─── END AVATAR-CACHE-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN AVATAR-CACHE-PURE sentinel missing");
assert.notEqual(to, -1, "END AVATAR-CACHE-PURE sentinel missing");
assert.ok(to > from, "avatar-cache sentinels out of order");
const BLOCK = SRC.slice(from, to);

// The sliced block must stay electron/fs/require/SDK-free (only Node globals allowed).
for (const banned of ["require(", "electron", "fs.", "path.", "child_process", "@anthropic", "process."]) {
  assert.ok(!BLOCK.includes(banned), `AVATAR-CACHE-PURE block must not reference ${banned}`);
}

const KB = 1024;
const MAX_BYTES = 256 * KB;

// Build a fresh module surface with an injected fetch each test → clean cache state.
function build(routes) {
  let fetchCount = 0;
  const calls = [];
  const mockFetch = (url, opts) => {
    fetchCount++;
    calls.push({ url, opts });
    const r = routes.get(url);
    if (!r) return Promise.reject(new Error("no route"));
    const res = r();
    return res && res.__throw ? Promise.reject(new Error("net")) : Promise.resolve(res);
  };
  const api = new Function(
    "fetch",
    `${BLOCK}\n return { getDataUri, cached, isHttpsUrl, isImageContentType, isSafeAvatarHost, sizeWithinLimit, assembleDataUri };`
  )(mockFetch);
  return { ...api, get fetchCount() { return fetchCount; }, calls };
}

// A mock image response. Optionally omit content-length; optionally a specific body.
function imgRes(bytes, { ct = "image/png", contentLength } = {}) {
  return () => ({
    ok: true,
    headers: {
      get: (k) =>
        k === "content-type" ? ct : k === "content-length" ? (contentLength == null ? null : String(contentLength)) : null,
    },
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  });
}

// ── Guards (direct) ────────────────────────────────────────────────────────────

test("guards: isHttpsUrl accepts only https:// strings", () => {
  const { isHttpsUrl } = build(new Map());
  assert.equal(isHttpsUrl("https://lh3.googleusercontent.com/a"), true);
  for (const bad of ["http://x", "data:image/png;base64,AA", "file:///x", "//x", "", null, undefined, 42]) {
    assert.equal(isHttpsUrl(bad), false, `${String(bad)} is not https`);
  }
});

test("guards: isImageContentType accepts only RASTER image/* (case-insensitive), rejects svg", () => {
  const { isImageContentType } = build(new Map());
  assert.equal(isImageContentType("image/png"), true);
  assert.equal(isImageContentType("IMAGE/JPEG"), true);
  assert.equal(isImageContentType("image/webp;charset=x"), true);
  for (const bad of ["image/svg+xml", "text/html", "application/json", "", null, undefined]) {
    assert.equal(isImageContentType(bad), false);
  }
});

test("guards: isSafeAvatarHost blocks internal/loopback/link-local hosts (SSRF)", () => {
  const { isSafeAvatarHost } = build(new Map());
  // Public avatar hosts pass.
  assert.equal(isSafeAvatarHost("https://lh3.googleusercontent.com/a/AC"), true);
  assert.equal(isSafeAvatarHost("https://cdn.example.com/x.png"), true);
  // Internal / loopback / link-local / metadata / private literals blocked.
  for (const bad of [
    "https://169.254.169.254/latest/meta-data/", // cloud metadata
    "https://127.0.0.1/x", "https://localhost/x", "https://foo.localhost/x",
    "https://10.0.0.5/x", "https://192.168.1.9/x", "https://172.16.4.4/x",
    "https://100.64.0.1/x", "https://0.0.0.0/x", "https://box.internal/x",
    "https://svc.local/x", "https://[::1]/x", "https://[fe80::1]/x", "https://[fc00::1]/x",
    "https://999.1.1.1/x", // malformed octet → block
  ]) {
    assert.equal(isSafeAvatarHost(bad), false, `${bad} must be blocked`);
  }
});

test("guards: sizeWithinLimit fails closed on NaN / negative / over-cap", () => {
  const { sizeWithinLimit } = build(new Map());
  assert.equal(sizeWithinLimit(0, MAX_BYTES), true);
  assert.equal(sizeWithinLimit(MAX_BYTES, MAX_BYTES), true);
  assert.equal(sizeWithinLimit(MAX_BYTES + 1, MAX_BYTES), false);
  assert.equal(sizeWithinLimit(-1, MAX_BYTES), false);
  assert.equal(sizeWithinLimit(NaN, MAX_BYTES), false);
});

test("guards: assembleDataUri builds a data: URI, or null over the length cap / bad ct", () => {
  const { assembleDataUri } = build(new Map());
  assert.equal(assembleDataUri("image/png", "QUFB", 1000), "data:image/png;base64,QUFB");
  assert.equal(assembleDataUri("text/html", "QUFB", 1000), null, "non-image content-type -> null");
  assert.equal(assembleDataUri("image/png", "", 1000), null, "empty base64 -> null");
  assert.equal(assembleDataUri("image/png", "QUFBQUFB", 10), null, "over the assembled-length cap -> null");
});

// ── getDataUri: the bounded fetch+encode ────────────────────────────────────────

test("getDataUri: a non-https url returns null WITHOUT fetching or caching", async () => {
  const c = build(new Map());
  assert.equal(await c.getDataUri("http://insecure/a.png"), null);
  assert.equal(await c.getDataUri("data:image/png;base64,AAAA"), null);
  assert.equal(c.fetchCount, 0, "a non-https url must never hit the network");
});

test("getDataUri: a non-image content-type returns null", async () => {
  const url = "https://host/not-an-image";
  const c = build(new Map([[url, imgRes([1, 2, 3], { ct: "text/html" })]]));
  assert.equal(await c.getDataUri(url), null);
});

test("getDataUri: a declared content-length over 256KB returns null (before reading body)", async () => {
  const url = "https://host/huge";
  const c = build(new Map([[url, imgRes([1, 2, 3], { contentLength: MAX_BYTES + 1 })]]));
  assert.equal(await c.getDataUri(url), null);
});

test("getDataUri: an actual body over 256KB returns null (no content-length header)", async () => {
  const url = "https://host/sneaky";
  const big = new Array(MAX_BYTES + 1).fill(65);
  const c = build(new Map([[url, imgRes(big)]]));
  assert.equal(await c.getDataUri(url), null);
});

test("getDataUri: a valid small image assembles a data: URI", async () => {
  const url = "https://host/a.png";
  const c = build(new Map([[url, imgRes([65, 66, 67], { ct: "image/png" })]]));
  const uri = await c.getDataUri(url);
  assert.equal(uri, `data:image/png;base64,${Buffer.from([65, 66, 67]).toString("base64")}`);
  assert.ok(uri.startsWith("data:image/"), "the only non-text DOM value is a data: URI");
});

test("getDataUri: a content-type with params is trimmed to the bare mime", async () => {
  const url = "https://host/p.jpg";
  const c = build(new Map([[url, imgRes([1, 2], { ct: "image/jpeg; charset=binary" })]]));
  const uri = await c.getDataUri(url);
  assert.ok(uri.startsWith("data:image/jpeg;base64,"), "params stripped from the data: mime");
});

test("getDataUri: a network throw degrades to null (never surfaces the error/url)", async () => {
  const url = "https://host/boom";
  const c = build(new Map([[url, () => ({ __throw: true })]]));
  assert.equal(await c.getDataUri(url), null);
});

// ── Distinctness (the two-authors-two-avatars guarantee) ────────────────────────

test("getDataUri: two DIFFERENT urls resolve to two DIFFERENT data URIs (self != peer)", async () => {
  const selfUrl = "https://host/self.png";
  const peerUrl = "https://host/peer.png";
  const c = build(
    new Map([
      [selfUrl, imgRes([1, 1, 1])],
      [peerUrl, imgRes([9, 9, 9])],
    ])
  );
  const self = await c.getDataUri(selfUrl);
  const peer = await c.getDataUri(peerUrl);
  assert.ok(self && peer, "both resolve");
  assert.notEqual(self, peer, "distinct images must never collapse to the same data URI");
});

// ── Cache: positive + negative ─────────────────────────────────────────────────

test("cache: a positive result is memoized — the same url fetches ONCE", async () => {
  const url = "https://host/cached.png";
  const c = build(new Map([[url, imgRes([7, 7])]]));
  const a = await c.getDataUri(url);
  const b = await c.getDataUri(url);
  assert.equal(a, b);
  assert.equal(c.fetchCount, 1, "second call served from cache");
});

test("cache: a NEGATIVE result is memoized — a broken avatar does not re-fetch in a storm", async () => {
  const url = "https://host/bad";
  const c = build(new Map([[url, imgRes([1], { ct: "text/html" })]]));
  assert.equal(await c.getDataUri(url), null);
  assert.equal(await c.getDataUri(url), null);
  assert.equal(c.fetchCount, 1, "the null is cached; no re-fetch");
});

test("cached(url): sync — undefined before fetch, the data URI after, null for a negative", async () => {
  const good = "https://host/g.png";
  const bad = "https://host/b";
  const c = build(
    new Map([
      [good, imgRes([2, 2])],
      [bad, imgRes([1], { ct: "text/plain" })],
    ])
  );
  assert.equal(c.cached(good), undefined, "not yet fetched -> undefined (init falls back to initials)");
  const uri = await c.getDataUri(good);
  assert.equal(c.cached(good), uri, "warm -> the data URI (init fast path)");
  await c.getDataUri(bad);
  assert.equal(c.cached(bad), null, "a known-bad url is a cached null");
});
