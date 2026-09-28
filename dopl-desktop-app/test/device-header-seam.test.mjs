// `X-Dopl-Device` rides BOTH fetch seams, so the MCP token mints (mcp-config.js device token,
// session-credential.js container tokens) carry this computer's id with no edit at the call site.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

function asyncFnOf(src, name) {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let i = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

test("both seams require device-identity and spread deviceHeaders onto the headers literal", () => {
  for (const f of ["api.js", "listener-io.js"]) {
    const src = M(f);
    assert.match(src, /const deviceIdentity = require\('\.\/device-identity'\);/, f);
    assert.match(src, /const headers = \{ Accept: 'application\/json', [^\n]*\.\.\.deviceIdentity\.deviceHeaders\(\)/, f);
  }
});

test("api.js › sendOnce puts X-Dopl-Device on the wire (and nothing when unknown)", async () => {
  const run = async (deviceHeaders) => {
    const seen = [];
    const sendOnce = new Function(
      "auth", "appVersion", "deviceIdentity", "API_BASE", "fetch",
      `${asyncFnOf(M("api.js"), "sendOnce")}\n return sendOnce;`
    )(
      { getAuthCookie: async () => "sb=1" },
      { versionHeaders: () => ({ "X-Dopl-App-Version": "1.0.0" }) },
      { deviceHeaders },
      "https://app.test",
      async (url, init) => { seen.push(init.headers); return { status: 200 }; }
    );
    await sendOnce("/api/auth/mcp-device-token", { method: "POST", body: { label: "x" } });
    return seen[0];
  };
  const id = "11111111-1111-4111-8111-111111111111";
  const h = await run(() => ({ "X-Dopl-Device": id }));
  assert.equal(h["X-Dopl-Device"], id);
  assert.equal(h["X-Dopl-App-Version"], "1.0.0");
  assert.equal("X-Dopl-Device" in (await run(() => ({}))), false);
});

test("the token mint sites set no device header themselves", () => {
  for (const f of ["mcp-config.js", "session-credential.js"]) {
    assert.equal(/X-Dopl-Device/.test(M(f)), false, `${f} should inherit it from the seam`);
  }
});
