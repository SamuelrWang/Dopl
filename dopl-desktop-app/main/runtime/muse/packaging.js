// How the Muse binary reaches an operator: NEVER bundled — Meta Model API terms §10.1(xiv) forbid
// redistributing Downloadable Materials. Dopl downloads Meta's own signed build from Meta's release channel
// into its userData on the operator's request (`update-source.js`, verified by sha256 + size + Meta's
// Developer ID team before it is adopted), or runs a `muse` the operator installed (`resolve-bin.js`).

const packaging = {
  delivery: 'path',
  // NULL: nothing is unpacked from the app bundle (there is no bundled copy).
  unpackGlobs: null,
  // NULL: nothing is signed by us; a download keeps Meta's own signature (`update-source.js › teamId`).
  signing: null,
  // NULL while `delivery` is `path`: this release ships no build to pin.
  versionPin: null,
};

module.exports = { packaging };
