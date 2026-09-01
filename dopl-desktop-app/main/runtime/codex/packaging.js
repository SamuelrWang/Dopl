// HOW THIS RUNTIME'S BINARY REACHES AN OPERATOR'S MACHINE — descriptor data, not a build chore.
//
// ⚠ `delivery: 'path'` FOR v1, AND IT IS A SECURITY AND SUPPORT DECISION TAKEN, NOT DEFERRED. The
// design (§2.4) puts both answers side by side and refuses to pick one; this is the pick, with the
// trade written down, and it is FLAGGED FOR SAMUEL'S END REVIEW rather than treated as settled —
// the amendment is dated in `platform-research/adapter-architecture.md` §2.4.
//
//                      bundled                              path (chosen)
//   supply chain       ours — we sign and notarise a         the operator's — we exec whatever is
//                      vendor binary                         on PATH
//   version skew       pinned by `versionPin`;               unbounded; `available()` must probe
//                      `initialize` negotiation is belt      and refuse
//   bundle size        +1 vendor binary of the Claude        none
//                      Mach-O's order of magnitude
//   `available()`      "not built into this release"         "install `codex` and re-open"
//
// ⚠ WHY `path` WINS FOR v1, IN ORDER OF WEIGHT:
//   1. ⚠ BUNDLING IS NOT A BUILD FLAG, IT IS A RELEASE LANE. The Claude binary is `asarUnpack`ed
//      because a 256 MB Mach-O cannot exec from inside the read-only `app.asar` and `codesign`
//      cannot sign a file inside it; it then rides `hardenedRuntime` + `entitlements.mac.plist` +
//      `afterSign: scripts/notarize.js`. A second bundled runtime inherits every one of those
//      lines AND adds its own notarisation step to a release lane that has already produced two
//      partial-upload incidents (F-193). Discovering that at ship time is the class of failure
//      §2.4 exists to prevent.
//   2. THE PACKAGING QUESTION IS ITSELF UNMEASURED. §5 item C16 asks whether there IS a
//      single-file, signable `codex` binary and what it weighs. `bundled` cannot be chosen
//      honestly before that is answered; `path` can be shipped and later reversed, and the reverse
//      direction is additive (a bundled binary simply becomes the first thing `available()` finds).
//   3. CODEX AND CLAUDE ARE NOT IN THE SAME POSITION. Claude's binary is a dependency this app
//      already resolves through `require.resolve`; `codex` is a CLI its own users install and
//      update on their own cadence, and the config, auth and session state it reads
//      (`~/.codex/`, `codex login`) are the operator's either way. Bundling the binary while the
//      credential and config stay the operator's buys half a supply chain and none of the
//      isolation.
//
// ⚠ WHAT `path` COSTS, STATED SO IT IS NOT DISCOVERED LATER:
//   - "it works on my machine" becomes the support story; two operators can run two Codex versions
//     against one Dopl build, and §5 item C15 (protocol stability) stops being belt and becomes
//     the thing that catches a skew.
//   - `available()` is a REAL probe of something we do not control, so its refusal has to be
//     readable by an operator rather than by a log reader. `client.js › probe` is written that way
//     on purpose: it names the command to run, not an errno.
//   - `versionPin` is `null` and must stay null while delivery is `path`. A pin would be a claim
//     about a binary this release does not choose.

const packaging = {
  delivery: 'path',
  // ⚠ NULL BECAUSE NOTHING IS UNPACKED — `test/runtime-contract.test.mjs` asserts exactly this for
  // a path-delivered runtime, so the descriptor and the build file cannot drift into disagreeing
  // about a binary one of them thinks it ships.
  unpackGlobs: null,
  // ⚠ NULL, NOT `'external'`. Nothing about this binary is signed by us, and nothing is fetched at
  // runtime either — the operator installed it and their own Gatekeeper assessment is what let it
  // run. `'external'` would imply a signing lane somewhere in our release; there is none.
  signing: null,
  // ⚠ NULL WHILE `delivery` IS `path`, AND THAT IS THE HONEST ANSWER RATHER THAN A GAP. A version
  // pin is a claim that THIS release ships THAT protocol build; a discovered binary makes the
  // claim unmakeable. §5 item C15 pins a version the day delivery becomes `bundled`, and until
  // then `initialize` capability negotiation is the only version check there is — which is why
  // `client.js` treats the handshake as mandatory rather than optional.
  versionPin: null,
};

module.exports = { packaging };
