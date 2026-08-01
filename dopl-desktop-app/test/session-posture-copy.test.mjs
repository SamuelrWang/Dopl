// v2.9 THE POSTURE LINE — the copy the session header states about BOTH permission axes.
//
// SPLIT from test/session-permission-axes.test.mjs (2026-07-31), which sat exactly ON the
// eslint max-lines 500 cap. That file owns the TRUTH TABLES and the invariant; this one owns
// the operator-facing WORDS the two axes resolve to, which is a different thing to change and
// a different thing to read. Both drive the same renderer module (renderer/session/
// session-labels.js) directly, so nothing is mocked here either.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const labels = require(R("session-labels.js"));

test("permissionPostureText states BOTH axes, in the contract's exact words", () => {
  assert.equal(
    labels.permissionPostureText("manual", "ask", "Full access"),
    "Tools: Asking before each command · Messages: Asking before messages in and out · Full access"
  );
  assert.equal(
    labels.permissionPostureText("accept_edits", "auto_inbound", null),
    "Tools: Auto approving file edits · Messages: Auto accepting incoming messages"
  );
  // FIX F2: the `auto` line names the workspace writes it now gates. It used to say only "asking
  // for shell and web" while auto-approving the Dopl write tools, i.e. data off this machine.
  assert.equal(
    labels.permissionPostureText("auto", "auto_outbound", ""),
    "Tools: Auto approving local edits and lookups, asking for shell, web and workspace writes" +
    " · Messages: Auto sending outgoing messages"
  );
  assert.equal(
    labels.permissionPostureText("bypass", "auto_both", null),
    "Tools: Auto approving every command the tool profile allows · Messages: Messages flow automatically"
  );
  // A junk mode reads as the most restrictive line, never a more permissive one.
  assert.equal(labels.permissionPostureText("nonsense", "nonsense", null), labels.permissionPostureText("manual", "ask", null));
  // No em dash anywhere in our own copy (§H-13).
  for (const t of ["manual", "accept_edits", "auto", "bypass"]) {
    for (const m of ["ask", "auto_inbound", "auto_outbound", "auto_both"]) {
      assert.ok(!labels.permissionPostureText(t, m, "Full access").includes("—"), t + "/" + m);
    }
  }
});

test("bypassNoticeText fires for bypass ONLY, and says it is per session", () => {
  assert.equal(labels.bypassNoticeText("bypass"), "Bypass is on for this session only");
  for (const m of ["manual", "accept_edits", "auto", undefined, null, "nonsense"]) {
    assert.equal(labels.bypassNoticeText(m), "", String(m));
  }
  assert.ok(!labels.bypassNoticeText("bypass").includes("—"));
});
