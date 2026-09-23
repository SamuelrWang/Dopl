// `codex/client.js › connect` over a real child process — a node stand-in for `codex app-server`.
//
// CX-01: a request line past the pipe's high-water mark is queued, not refused.
// CX-10: a spawn failure rejects with its own errno and still reports the exit; a response written
//        just before the child exits still resolves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const client = require("../main/runtime/codex/client.js");
const resolveBin = require("../main/runtime/codex/resolve-bin.js");

// Answers every request with the byte length of its line; `bye` answers and then lets it exit.
const STAND_IN = `#!/usr/bin/env node
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let at = buf.indexOf('\\n');
  while (at !== -1) {
    const line = buf.slice(0, at); buf = buf.slice(at + 1); at = buf.indexOf('\\n');
    const msg = JSON.parse(line);
    if (msg.id == null) continue;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { bytes: line.length } }) + '\\n');
    if (msg.method === 'bye') process.stdin.destroy();
  }
});
`;

function withBinary(path, fn) {
  const original = resolveBin.resolveCodexBin;
  resolveBin.resolveCodexBin = () => ({ ok: true, path, source: "override", reason: "", rejected: [] });
  return Promise.resolve().then(fn).finally(() => { resolveBin.resolveCodexBin = original; });
}

function standIn() {
  const dir = mkdtempSync(join(tmpdir(), "dopl-codex-client-"));
  const file = join(dir, "codex");
  writeFileSync(file, STAND_IN);
  chmodSync(file, 0o755);
  return file;
}

test("CX-01: a request larger than the pipe's high-water mark is delivered and answered", async () => {
  await withBinary(standIn(), async () => {
    const exits = [];
    const conn = client.connect({ onExit: (...a) => exits.push(a) });
    try {
      const big = "x".repeat(200 * 1024);
      const result = await conn.request("turn/steer", { input: [{ type: "text", text: big }] });
      assert.ok(result.bytes > 200 * 1024, "the whole line reached the server");
      const next = await conn.request("initialize", {});
      assert.ok(next.bytes > 0, "and the connection is still usable after it");
      assert.deepEqual(exits, [], "nothing exited");
    } finally {
      conn.close();
    }
  });
});

test("CX-10: a binary that cannot start rejects with its errno and still reports the exit", async () => {
  await withBinary(join(tmpdir(), "dopl-no-such-codex", "codex"), async () => {
    let exited = null;
    const done = new Promise((resolve) => {
      exited = resolve;
    });
    const conn = client.connect({ onExit: (code, signal, err) => exited({ code, signal, err }) });
    await assert.rejects(conn.request("initialize", {}), /ENOENT/);
    const exit = await done;
    assert.match(String(exit.err && exit.err.message), /ENOENT/, "the real cause rides the exit report");
    await assert.rejects(conn.request("model/list", {}), /ENOENT/, "later requests name the cause too");
  });
});

test("CX-10: a response written just before the child exits still resolves", async () => {
  await withBinary(standIn(), async () => {
    let exited = null;
    const done = new Promise((resolve) => {
      exited = resolve;
    });
    const conn = client.connect({ onExit: (code, signal) => exited({ code, signal }) });
    const result = await conn.request("bye", {});
    assert.ok(result.bytes > 0);
    assert.deepEqual(await done, { code: 0, signal: null }, "and the exit is reported once, after stdout drained");
    await assert.rejects(conn.request("initialize", {}), /not running|exited/);
  });
});
