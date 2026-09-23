// An approval given before the template→identity rename still counts after the upgrade (P3-10):
// `identity-approval.js` reads the pre-rename electron-store key as a fallback and never writes it.
//
// Run: `node --test dopl-desktop-app/test/identity-approval-legacy.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWithStubs } from "./helpers/module-sandbox.mjs";

/** The module over a fake electron-store document. */
function load(doc) {
  const store = { get: (k) => doc[k], set: (k, v) => { doc[k] = v; } };
  return loadWithStubs("identity-approval.js", { "electron-store": function Store() { return store; }, "./diag": { diag: () => {} } });
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
