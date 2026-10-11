// HOW THIS RUNTIME REACHES AN OPERATOR'S MACHINE — descriptor data, not a build chore.
//
// ⚠ `delivery: 'path'` FOR v1, flagged for Samuel's end review (§5 item X10, this runtime's C16).
// `@cursor/sdk` is a TypeScript library, so "bundled" would mean an npm dependency. Why `path`:
//   1. The SDK is public beta (TS since 2026-04-29, API may move) and the ship gate X0 is open:
//      a beta package in the dependency tree buys supply-chain surface for nothing.
//   2. What the SDK's local runtime needs on the machine (pure JS? shells to `cursor-agent`?
//      a native component to sign?) is unmeasured (X10). `path` is reversible additively: a
//      bundled package simply becomes the first thing `client.js › loadSdk` resolves.
//   3. Credential and config (`CURSOR_API_KEY`, `agent login`, `~/.cursor/*.json`, hooks) are the
//      operator's either way, with no per-launch flag to skip them (X13).
// What `path` costs: version skew across operators (hence tolerant readers in `normalize.js` /
// `models.js` and `client.js › agentNamespace` failing loudly), and `available()` probes something
// we do not control, so its refusal must be operator-readable.
// Reverses when X10 says "pure JS", X0 is answered and the SDK leaves beta.

const packaging = {
  delivery: 'path',
  // NULL because nothing is unpacked — `test/runtime-contract.test.mjs` asserts this for a
  // path-delivered runtime.
  unpackGlobs: null,
  // NULL, not `'external'`: nothing is signed by us and nothing is fetched; the operator installed it.
  signing: null,
  // NULL while `delivery` is `path`: a pin claims THIS release ships THAT build, which it cannot.
  versionPin: null,
};

module.exports = { packaging };
