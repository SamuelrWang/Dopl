// WHAT DOPL READS FROM CLAUDE CODE — and nothing else (`../sdk-shape.js`), tiered by what a gap costs.
// Checked against the pairing's own description of itself (`shape.js`, turn-free via
// `roster.js › observeShape`) at launch and before the updater adopts a build.
//
// ⚠ ONLY WHAT DOPL READS from the pairing (bundled SDK JS + the active CLI). Per-message fields (init's
// permission mode and tools) are checked on every launch instead (`launch-contract.js`).
// ⚠ NO `safety` TIER HERE (cross-review LOW, 2026-10-08): `query`/`interrupt` are the BUNDLED SDK's own
// exports and methods, so on a CLI update they could never be missing (a tautology); they are `core`.
// The CLI's safety is checked where it can fail: every launch's init (`launch-contract.js`) and every
// candidate build's live semantics (`semantics.js`).

module.exports = {
  // No `query` = nothing runs; no `interrupt` = Stop cannot stop an agent; the roster and a live switch.
  core: {
    exports: ['query'],
    methods: ['interrupt', 'supportedModels', 'setModel'],
    results: { supportedModels: ['value', 'displayName'] },
  },
  // Labels and the in-process agent-ops server (`axis-b.js` mounts nothing without them).
  cosmetic: { exports: ['createSdkMcpServer', 'tool'], results: { supportedModels: ['resolvedModel'] } },
};
