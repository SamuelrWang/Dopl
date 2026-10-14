// How the Grok binary reaches an operator: NEVER bundled — it is xAI's own signed build (172 MB, separate
// download terms not reviewed; `xai-org/grok-build` source is Apache-2.0). Dopl downloads xAI's build from
// xAI's stable channel into its userData on the operator's request (`update-source.js`, verified by xAI's
// Developer ID team before it is adopted, its sha256 recorded), or runs a `grok` the operator installed
// (`resolve-bin.js`).

const packaging = {
  delivery: 'path',
  // NULL: nothing is unpacked from the app bundle (there is no bundled copy).
  unpackGlobs: null,
  // NULL: nothing is signed by us; a download keeps xAI's own signature (`update-source.js › teamId`).
  signing: null,
  // NULL while `delivery` is `path`: this release ships no build to pin.
  versionPin: null,
};

module.exports = { packaging };
