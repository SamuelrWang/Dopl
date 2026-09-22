// HOW THIS RUNTIME'S BINARY REACHES AN OPERATOR'S MACHINE — descriptor data, not a build chore.
//
// ⚠ `delivery: 'bundled'` BY SAMUEL'S RULING OF 2026-09-22, WHICH REVERSED THIS FILE'S OWN v1
// ANSWER. The decision, verbatim: *"i think we should go with the binary. Let's just do it. We can
// bundle and everything with the push later."* The header below used to be the written argument
// FOR `path`; it is kept as a record of what the reversal cost, because every line of it is still
// true — it is now a list of work owed, not a reason to decline.
//
//                      bundled (chosen 2026-09-22)            path (v1, superseded)
//   supply chain       ours — we re-sign and notarise         the operator's — we exec whatever is
//                      OpenAI's vendor binaries               on PATH
//   version skew       pinned by `versionPin`;                unbounded; `available()` must probe
//                      one release, one protocol build        and refuse
//   bundle size        +302 MiB installed, +~118 MiB to       none
//                      the compressed download (measured
//                      2026-09-22, see below)
//   `available()`      answers from the bundled binary        "install `codex` and re-open"
//
// ⚠ WHAT THE RULING ANSWERED, AND WHAT IT DID NOT:
//   1. ⚠ THE LICENCE QUESTION IS CLOSED. `@openai/codex@0.155.1` and every one of its per-platform
//      packages are **Apache-2.0** (`node_modules/@openai/codex*/package.json › license`, read
//      2026-09-22). Redistribution is permitted with attribution; that was the open blocker and it
//      is answered, not assumed.
//   2. ⚠ §5 ITEM C16 ("is there a single-file signable binary, and what does it weigh") IS
//      ANSWERED AND THE ANSWER IS "NO, THERE ARE FIVE". The darwin-arm64 package carries FIVE
//      Mach-O executables and ~25 dylibs, not the two the first measurement found:
//        `vendor/aarch64-apple-darwin/bin/codex`                     218 MB
//        `vendor/aarch64-apple-darwin/bin/codex-code-mode-host`       60 MB
//        `vendor/aarch64-apple-darwin/codex-resources/voice/bin/codex-voice-host`  8.9 MB
//        `vendor/aarch64-apple-darwin/codex-path/rg`                 3.8 MB (ripgrep)
//        `vendor/aarch64-apple-darwin/codex-resources/zsh/bin/zsh`   740 KB
//      **THIS IS WHY `unpackGlobs` UNPACKS THE WHOLE PACKAGE AND NOT A LIST OF BINARIES.** The CLI
//      finds `rg`, the voice host, its gstreamer plugins and its `zsh` RELATIVE TO ITS OWN
//      DIRECTORY; a glob naming only `bin/**` would ship a `codex` that launches and then fails at
//      the first search or shell tool call. It is also exactly the shape of Claude's precedent
//      (`../claude/packaging.js`), whose globs cover the whole platform package for the same
//      reason.
//   3. ⚠ THE RELEASE LANE IS STILL THE EXPENSIVE PART, AND IT IS DEFERRED, NOT REMOVED. Samuel's
//      "with the push later" is the deferral. What a release now additionally owes:
//        - `codesign` must reach FIVE nested Mach-Os and ~25 dylibs and re-sign them under Dopl's
//          identity. They arrive signed by OpenAI (Team `2DC432GLL2`, `flags=0x10000(runtime)`),
//          which is NOT a substitute: notarisation requires every executable in the bundle to
//          carry OUR team's signature. The replacement is expected, not a problem — but it is a
//          step the lane has never run at this scale, on a release that has already produced two
//          partial-upload incidents (F-193).
//        - `entitlements.mac.plist` already covers what the vendor binaries ask for. `codex` is
//          signed with `allow-jit` + `allow-unsigned-executable-memory`; both are already in our
//          file, and `entitlementsInherit` points at the same file, so nested re-signing inherits
//          them. Nothing new is needed here — verified 2026-09-22, do not re-derive from memory.
//   4. ⚠ THE SIZE CONSEQUENCE, MEASURED 2026-09-22 AND SAID OUT LOUD BECAUSE F-192 IS OPEN.
//      `node_modules/@openai` is **302 MiB on disk** and **~118 MiB gzipped** (`tar … | gzip -6`),
//      against Claude's ~73 MiB gzipped. F-192 records that release assets download off GitHub at
//      ~0.9 MB/s with no CDN, so this adds roughly **two minutes to every download and every
//      auto-update**. ⚠ THIS FILE DOES NOT SOLVE F-192 AND MUST NOT PRETEND TO — it records that
//      bundling makes F-192 hurt about 60% more.
//   5. ⚠ WHAT DID NOT CHANGE: the CONFIG, AUTH and SESSION STATE are still the operator's
//      (`~/.codex/`, `codex login`). Bundling the binary buys a deterministic protocol build; it
//      does not buy isolation, and `config-home.js` and `credential.js` are unchanged by this
//      ruling.
//
// ⚠ AND `path` DOES NOT DISAPPEAR — `resolve-bin.js` still searches PATH and the well-known
// prefixes BELOW the bundled binary. That is deliberate and its ordering argument lives there: a
// bundled binary that fails to resolve (a build whose optional platform package did not install)
// must degrade to the v1 behaviour rather than to nothing.

const packaging = {
  delivery: 'bundled',
  // ⚠ VERBATIM from `package.json › build.asarUnpack`, order included, and pinned against it by
  // `test/runtime-contract.test.mjs` — a descriptor that merely paraphrases the build is a
  // descriptor that will be wrong the first time the build changes. This is Claude's rule applied
  // to Codex, deliberately, down to the two-glob shape (the platform package, then the launcher).
  // ⚠ THE FIRST GLOB IS THE LOAD-BEARING ONE and it covers the WHOLE platform package rather than
  // its `bin/` — see item 2 above. The second covers the thin `bin/codex.js` launcher, which Dopl
  // never execs (it resolves the vendor binary directly, as the Claude adapter does) but which
  // `require.resolve` walks past.
  unpackGlobs: [
    '**/@openai/codex-*/**',
    '**/@openai/codex/**',
  ],
  // ⚠ The vendor binaries are re-signed and notarised as part of the app, under the app's own
  // identity and entitlements — the same answer as Claude's, and the reason this stopped being
  // `null`. They ship signed by OpenAI; `codesign` replaces that with ours, which is what
  // notarisation requires. Nothing is fetched at runtime.
  signing: 'inherits-app-identity',
  // ⚠ A CLAIM THIS RELEASE CAN NOW ACTUALLY MAKE, which is the whole difference from v1. It is the
  // version `client.js › SUPPORTED_CLI` was measured from and the version `package.json ›
  // dependencies` pins EXACTLY (`--save-exact`, not a caret) — a range here would make the pin a
  // guess about whatever `npm install` last resolved.
  // ⚠ `checkProtocol` IS STILL THE GATE, AND BUNDLING DOES NOT RETIRE IT. The `initialize`
  // handshake declares NO METHODS — it answers `{ codexHome, platformFamily, platformOs,
  // userAgent }` — so it never could have been the version check. What bundling removes is the
  // SKEW, not the check: an operator's `DOPL_CODEX_BIN` override still points this build at
  // someone else's CLI, on purpose.
  versionPin: '@openai/codex@0.155.1',
};

module.exports = { packaging };
