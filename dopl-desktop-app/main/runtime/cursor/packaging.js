// HOW THIS RUNTIME REACHES AN OPERATOR'S MACHINE — descriptor data, not a build chore.
//
// ⚠ `delivery: 'path'` FOR v1, AND IT IS THE SAME KIND OF DECISION THE OTHER PATH-DELIVERED
// RUNTIME'S WAS: a security and support call, taken rather than deferred, and FLAGGED FOR SAMUEL'S
// END REVIEW. The design (§2.4) puts both answers side by side and refuses to pick one, and says
// explicitly that Cursor's answer is step 8's — §5 item X10 is this runtime's C16.
//
// ⚠ AND THE QUESTION IS SHAPED DIFFERENTLY HERE, WHICH IS WORTH STATING BEFORE THE TABLE. The
// other two runtimes are BINARIES: a 256 MB Mach-O that Dopl `asarUnpack`s and signs, and a CLI
// the operator installs. This one is neither — `@cursor/sdk` is a TYPESCRIPT LIBRARY, so
// "bundled" would mean adding an npm dependency rather than a signing lane. That makes bundling
// LOOK cheap, and the reasons it is not are the ones below.
//
//                      bundled (a dependency)                path (chosen)
//   supply chain       ours — a PUBLIC BETA library on       the operator's — we import whatever
//                      our dependency tree and in our        they installed
//                      release
//   version skew       pinned by `versionPin`                unbounded; `available()` must probe
//                                                            and refuse
//   what it drags in   unmeasured: whether the local         nothing
//                      runtime also needs `cursor-agent`
//                      or a native component is X10
//   `available()`      "not built into this release"         "install it and re-open"
//
// ⚠ WHY `path` WINS FOR v1, IN ORDER OF WEIGHT:
//   1. ⚠ THE PACKAGE IS PUBLIC BETA AND THE ADAPTER'S OWN SHIP GATE IS OPEN. `cursor-research.md`
//      dates the TypeScript SDK to 2026-04-29 and says the API shape may move; §5 item X0 (no
//      documented interrupt) means the design's step 8 does not ship this runtime at all until it
//      is answered. Putting a beta package into the dependency tree of a release that does not yet
//      ship the feature it is for buys a supply-chain surface for nothing.
//   2. THE PACKAGING QUESTION IS ITSELF UNMEASURED. §5 item X10 asks what the SDK's local runtime
//      actually requires on the machine — whether it is pure JS, whether it shells out to
//      `cursor-agent`, whether it carries a native component that would need signing and
//      notarising like the Claude binary does. `bundled` cannot be chosen honestly before that is
//      answered. `path` can be shipped and later reversed, and THE REVERSE DIRECTION IS ADDITIVE:
//      a bundled package simply becomes the first thing `client.js › loadSdk` resolves.
//   3. THE CREDENTIAL AND THE CONFIG ARE THE OPERATOR'S EITHER WAY. `CURSOR_API_KEY`,
//      `agent login`, `~/.cursor/cli-config.json`, `~/.cursor/mcp.json` and up to four hook tiers
//      are all theirs, and there is no documented per-launch flag that skips any of them
//      (§5 item X13). Bundling the library while every one of those stays the operator's buys half
//      a supply chain and none of the isolation — the same argument the other path-delivered
//      runtime records, and it lands harder here because the config surface is wider.
//
// ⚠ WHAT `path` COSTS, STATED SO IT IS NOT DISCOVERED LATER:
//   - "it works on my machine" becomes the support story, and on a PUBLIC BETA that is a real
//     cost rather than a theoretical one: two operators can hold two SDK revisions against one
//     Dopl build, and the API shape is documented as liable to move. This is why every reader in
//     `normalize.js` and `models.js` is tolerant and why `client.js › agentNamespace` fails LOUDLY
//     with what it saw rather than launching nothing.
//   - `available()` is a REAL probe of something we do not control, so its refusal has to be
//     readable by an operator rather than by a log reader. `client.js › probe` names the package
//     and says Dopl does not bundle it.
//   - `versionPin` is `null` and must stay null while delivery is `path`. A pin is a claim that
//     THIS release ships THAT build; a resolved-from-elsewhere package makes the claim unmakeable.
//     ⚠ There is no handshake to stand in for it either — the other path-delivered runtime at
//     least negotiates `initialize` against its app-server. Here the only version check is
//     `agentNamespace`'s shape assertion, which is why that function throws rather than shrugging.
//
// ⚠ WHAT WOULD REVERSE IT: X10 coming back "pure JS, no extra machine requirement" together with
// X0 answered and the SDK out of beta. All three are measurements, and none of them exists yet.

const packaging = {
  delivery: 'path',
  // ⚠ NULL BECAUSE NOTHING IS UNPACKED — `test/runtime-contract.test.mjs` asserts exactly this for
  // a path-delivered runtime, so the descriptor and the build file cannot drift into disagreeing
  // about something one of them thinks it ships.
  unpackGlobs: null,
  // ⚠ NULL, NOT `'external'`. Nothing here is signed by us and nothing is fetched at runtime
  // either — the operator installed it. `'external'` would imply a signing lane somewhere in our
  // release; there is none.
  signing: null,
  // ⚠ NULL WHILE `delivery` IS `path` — see the header's third cost.
  versionPin: null,
};

module.exports = { packaging };
