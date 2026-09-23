// **THE IDENTITY IS RESOLVED ONCE, AT REQUEST TIME, AND THE DESKTOP NEVER RE-RESOLVES A NAME**
// — G9's desktop half (2026-09-02, MCP/architecture v2 slice A10).
//
// ⚠ WHAT G9 SAYS AND WHY IT WAS A PROMPT-ONLY RULE. The `identity` param teaches that a ref is
// "resolved under YOUR visibility when you ask and under THE OPERATOR'S when their machine
// starts it" — two people, two resolutions, and for a NAME they can legitimately disagree
// (names are deliberately not unique across a visibility boundary). The fix the spec names is
// structural rather than textual: resolve to an ID at request time, store the ID, and let the
// desktop read CONTENT by that id and nothing else.
//
// ⚠ **BOTH HALVES ARE ALREADY IN THE TREE AND THIS FILE PINS THE ONE THAT WAS NOT DRIVEN.**
//   • the SERVER resolves the ref and stores the resolved id + a name SNAPSHOT —
//     `channels/server/service-launch-identity.ts › resolveIdentityForDirective`, driven by
//     `channels/server/service-launch-identity.test.ts` ("both columns or the feature does not
//     work");
//   • the DESKTOP refuses when only a NAME survives, with no resolve attempt (E-4) —
//     `test/launch-directive-identity.test.mjs`;
//   • what nothing drove: that `identity-resolve.js › resolveAgentIdentity` REFUSES A NAME OUTRIGHT.
//     The id-only rule lives in one predicate (`isIdentityId` → `ipc-guards.js › isUuid`), and a
//     single loosened line there would quietly reintroduce the second resolution — a name looked
//     up under the OPERATOR's visibility, which is exactly the two-identity state G9 is about.
//
// ⚠ AND THE REFUSAL COSTS NO ROUND TRIP, which is the observable half: a name that reached the
// network would be resolved by whoever the transport authenticates as, and this machine's
// transport is the OPERATOR's cookie session. The assertion is therefore on `requests` as much
// as on the answer.
//
// METHOD is `session-launch-identity.test.mjs`'s: evaluate the SHIPPED module body over a stub
// require, with the transport faked at exactly one seam.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bootIdentityResolve } from "./_session-launch-op-harness.mjs";

const IDENTITY_ID = "33333333-3333-4333-8333-333333333333";
const WS = "ws-1";

const RESOLVED = {
  name: "Code Auditor",
  instructions: "Audit the diff.",
  model: null,
  fields: [],
  knowledgeBases: [],
  authoredByCaller: true,
};

/** The real `identity-resolve.js`, over a transport that records every call. */
function boot() {
  const requests = [];
  const apiFetch = async (path, o) => {
    requests.push({ path, ...o });
    return { ok: true, status: 200, json: async () => RESOLVED };
  };
  return { ...bootIdentityResolve(apiFetch), requests };
}

test("an ID resolves, and it is the only thing that reaches the network", async () => {
  const m = boot();
  const res = await m.resolveAgentIdentity(IDENTITY_ID, WS);
  assert.equal(res.ok, true);
  assert.equal(res.identity.name, "Code Auditor");
  assert.equal(m.requests.length, 1);
  assert.equal(m.requests[0].path, `/api/agent-identities/${IDENTITY_ID}/resolve`);
});

test("🔒 a NAME is REFUSED, and costs no round trip — there is no second resolution", async () => {
  // ⚠ THE WHOLE OF G9 ON THIS SIDE. Every one of these is a legal `identity` value on the MCP
  // surface: the caller may name an identity by its exact name, and the SERVER turns that into an
  // id under the CALLER's visibility before any row exists. If any of them resolved here, the
  // same string would be resolved a second time under the OPERATOR's visibility — a different
  // person, a different answer, and nothing reconciling the two.
  for (const name of ["Code Auditor", "code auditor", "Researcher", "  ", "not-a-uuid"]) {
    const m = boot();
    assert.deepEqual(await m.resolveAgentIdentity(name, WS), { ok: false, reason: "no-identity" }, name);
    assert.deepEqual(m.requests, [], `a name must not reach the network: ${name}`);
  }
});

test("the id-only predicate is the SHARED uuid rule, never a local copy", async () => {
  // ⚠ `test/uuid-rule-parity.test.mjs` is a CENSUS of every file in `main/` that spells the rule
  // itself, and its standing instruction is that a new entry is a REVIEW rather than a rename.
  // Asserted here as behaviour rather than by grep: a value that is uuid-SHAPED but not a uuid
  // must be refused by the same predicate everything else uses.
  const m = boot();
  const { isIdentityId } = m;
  assert.equal(isIdentityId(IDENTITY_ID), true);
  for (const bad of ["33333333-3333-4333-8333-33333333333", `${IDENTITY_ID} `, "Code Auditor", "", null, 7]) {
    assert.equal(isIdentityId(bad), false, JSON.stringify(bad));
  }
});
