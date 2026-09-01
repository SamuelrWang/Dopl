// HOW THIS RUNTIME'S BINARY REACHES AN OPERATOR'S MACHINE — descriptor data, not a build chore.
//
// ⚠ `delivery` IS A SECURITY AND SUPPORT DECISION. `bundled` puts a vendor binary in OUR supply
// chain and our signing lane; `path` makes "it works on my machine" the support story and makes
// `available()` a probe of something we do not control. Claude's answer has been `bundled` since
// the desktop shipped, and the reasons are measurable, not preferences:
//   - `dopl-desktop-app/package.json › build.asarUnpack` carries exactly two globs, both the
//     Claude agent SDK, because the platform binary CANNOT EXEC from inside the read-only
//     `app.asar` and `codesign` cannot sign a file inside it (`loader.js`'s header).
//   - `build.mac.hardenedRuntime: true` + `entitlements.mac.plist` + `afterSign: scripts/notarize.js`
//     are what make that unpacked binary launchable on a sealed Mac at all.
// A second runtime answering `bundled` inherits every one of those lines and adds its own
// notarisation lane to the release; one answering `path` inherits none of them and owes
// `available()` a real probe with a real reason. Neither is free, and the choice belongs in the
// descriptor rather than in a build file nobody reads at design time.
//
// ⚠ `versionPin` IS THE PROTOCOL THIS ADAPTER WAS BUILT AGAINST, and it is a CLAIM about what was
// measured — the tool tables, the deferral behaviour, the per-server timeout clamp and the
// permission-mode semantics in `loader.js` and `tools.js` were all read off this build. A skew is
// not automatically a break, but it is the first thing to check when one appears.

const packaging = {
  delivery: 'bundled',
  // The two `asarUnpack` globs, named here so the descriptor and the build file can be pinned
  // against each other rather than drifting silently.
  // ⚠ VERBATIM from `package.json › build.asarUnpack`, order included, and pinned against it by
  // `test/runtime-contract.test.mjs` — a descriptor that merely paraphrases the build is a
  // descriptor that will be wrong the first time the build changes.
  unpackGlobs: [
    '**/@anthropic-ai/claude-agent-sdk-*/**',
    '**/@anthropic-ai/claude-agent-sdk/**',
  ],
  // ⚠ The vendor binary is signed and notarised as part of the app, under the app's own identity
  // and entitlements. Nothing separate is signed and nothing is fetched at runtime.
  signing: 'inherits-app-identity',
  // Measured 2026-08-31 off `dopl-desktop-app/package.json`.
  versionPin: '@anthropic-ai/claude-agent-sdk@0.3.220',
};

module.exports = { packaging };
