// An approval given before the template→identity rename still counts after the upgrade (P3-10):
// `identity-approval.js` reads the pre-rename electron-store key as a fallback and never writes it.
//
// Run: `node --test dopl-desktop-app/test/identity-approval-legacy.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "main", "identity-approval.js"),
  "utf8"
);

/** The module over a fake electron-store document. */
function load(doc) {
  const store = {
    get: (k) => doc[k],
    set: (k, v) => { doc[k] = v; },
  };
  const stub = (id) => {
    if (id === "electron-store") return function Store() { return store; };
    if (id === "./diag") return { diag: () => {} };
    throw new Error("unexpected require: " + id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stub, mod, mod.exports);
  return mod.exports;
}

test("an approval stored under the pre-rename key is honoured", () => {
  const m = load({ approvedAgentTemplates: { "id-old": true } });
  assert.equal(m.isIdentityApproved("id-old"), true);
  assert.equal(m.isIdentityApproved("id-new"), false);
});

test("new approvals land under the new key only; the legacy map is never rewritten", () => {
  const doc = { approvedAgentTemplates: { "id-old": true } };
  const m = load(doc);
  assert.equal(m.approveIdentity("id-new"), true);
  assert.deepEqual(doc.approvedAgentIdentities, { "id-new": true });
  assert.deepEqual(doc.approvedAgentTemplates, { "id-old": true });
  assert.equal(m.isIdentityApproved("id-new"), true);
});

test("a corrupt legacy value is not a grant", () => {
  for (const legacy of [null, "yes", ["id"], { id: "true" }]) {
    assert.equal(load({ approvedAgentTemplates: legacy }).isIdentityApproved("id"), false);
  }
});
