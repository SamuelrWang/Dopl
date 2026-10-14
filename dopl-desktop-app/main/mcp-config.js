// Dopl MCP auto-config for the Claude CLI. On a signed-in startup (and after a fresh sign-in):
//   1. Mint (or reuse) a long-lived device token from POST /api/auth/mcp-device-token
//      (`mcp-device-token-lifecycle.js`; its exports are re-exported from here).
//   2. DELETE userData/mcp-spawn.json if it is there. Nothing writes that file any more and
//      nothing in this app reads it — see `removeSpawnConfig` below for the whole argument.
//   3. Ensure a user-scope `dopl` entry exists in the CLI's own config (`claude mcp add …`),
//      NEVER churning an existing one.
//
// ⚠ NEVER reach into `~/.claude.json` to add a per-server `timeout` (mcp-cli-entry.js REMOVED).
// That file is the OPERATOR's — it holds their `oauthAccount` block — and `timeout` also LOWERS
// the hard tool-call ceiling (~27.8h -> the value) for their own terminal `claude` sessions.
// /api/mcp streams (c2f6a7e), so a long `op=await` hold is no longer 60s of silence. The fix
// belongs only on the entry we own: `runtime/claude/mcp.js`'s in-memory server, inside this process.
//
// ⚠ The token value NEVER hits logs/diag, and as of 2026-08-26 it never hits a file THIS APP
// WRITES either. It is stored safeStorage-encrypted (`mcp-device-token.js`) and passed as a
// `claude mcp add` header argv (mcp-cli-add.js), where the CLI — not this process — owns it.
// ⚠ The safeStorage cache is the ONLY source the SESSION path uses: `deviceTokenForSpawn()`
// hands `runtime/claude/mcp.js › buildMcpServers` the bearer in memory. Step 3 is now the ONLY step that
// serves the CLI path (manual `claude` runs); there is no headless spawn path left to serve.

const fs = require('fs');

const spawner = require('./session-spawner');
const { probeMcpEntry, removeMcpEntry, addMcpEntry } = require('./mcp-cli-add');
const { diag } = require('./diag');
// ⚠ THE CLAUDE ADAPTER'S, not core's — `~/.claude/skills` is one runtime's convention and
// core may not name one (test/core-vocabulary.test.mjs). This file is already on that scan's
// deferred census because it drives that runtime's CLI, which is the same lane and the same
// gate; a second runtime with a skills convention gets its own sibling, never a branch here.
const { ensureDoplSkills } = require('./runtime/claude/skill-install');
const { MCP_URL } = require('./config');
// ⚠ ONE INSTANCE each: the mint-listener Set lives in the store module, the mint and its memo in
// the lifecycle module. Re-exported below under the names every caller already requires.
const { onDeviceTokenMinted } = require('./mcp-device-token');
const lifecycle = require('./mcp-device-token-lifecycle');
const { ensureDeviceToken, spawnConfigPath } = lifecycle;

// ⚠ THE ONE DEFINITION of the per-server call abort every Dopl MCP entry this app builds must
// carry. `runtime/claude/mcp.js`'s in-memory entry is the only such entry left, and it IMPORTS this constant
// rather than restating it — restating is exactly how the two drifted the last time (a stale
// copy of this number against a server cap that had moved). ⚠ The old literal must not reappear
// in EITHER module, prose included; mcp-client-timeout.test.mjs bans it by value.
// ⚠ DO NOT HAND-TUNE. Arithmetic over packages/mcp-server/src/tools/channel-hold-budget.ts:
//   HOLD_CAP_MS 230_000    the LONGEST hold a caller can get via explicit `timeout_ms`
//                                (the 215_000 DEFAULT is not the bound that matters)
//   HOLD_MARGIN_MS 60_000  auth + MCP boot + workspace handshake on top of any hold
//   => must not abort before 290_000; MCP_ROUTE_MAX_DURATION_MS (300_000) is the upper bound.
// test/mcp-client-timeout.test.mjs pins the RELATION, so moving the cap fails a test.
// Verified against claude-agent-sdk 0.3.220 / Claude Code 2.1.220: the per-server `timeout`
// sets the HTTP abort to `min(max(timeout ?? MCP_TOOL_TIMEOUT ?? 60_000, 60_000), 2147483647)`
// — it can only RAISE above the 60s floor — and also LOWERS the hard tool-call ceiling from
// ~1e8 ms to this value. Both effects confined to entries this process owns.
const MCP_CLIENT_TIMEOUT_MS = 290_000;

// ── Spawn-config file: NOT WRITTEN ANY MORE, AND REMOVED ON SIGHT ────────────
// `spawnConfigPath` lives with the lifecycle (`clearDeviceToken` still rm's it at sign-out).

// ⚠ THIS APP NO LONGER WRITES A BEARER TO DISK, AND THIS FUNCTION IS THE MIGRATION THAT MAKES
// THAT TRUE OF MACHINES THAT ALREADY HAVE ONE. Until 2026-08-26, `writeSpawnConfig(token)` wrote
// the operator's UNLOCKED 90-day `dopl.read`+`dopl.write` device token here in PLAINTEXT (mode
// 600) on every signed-in launch. Merely stopping the write would have left every installed
// machine holding that credential on disk for up to 90 more days, so the ensure path DELETES the
// file instead: the token sheds on the next signed-in launch, without a sign-out.
//
// ⚠ WHY DELETED RATHER THAN FENCED — the fence that looked available is not one. `runtime/claude/tools.js`'s
// `buildSecretPathDenyRules` denies userData to SECRET_TOOLS = Read/Grep/Glob; `Bash` is NOT on
// that list, so one `cat` of this path lifted the credential. ADDING `'Bash'` WOULD BE THEATRE:
// Claude Code permission rules for `Bash` match COMMAND STRINGS, not filesystem path globs.
// Every `Bash(...)` literal in the bundled runtime is a command pattern — `Bash(npm run build)`,
// `Bash(git *)`, `Bash(rm -rf *)`, `Bash(prefix:*)` — and never a path, so a generated
// `Bash(//Users/…/**)` rule matches no command any session runs and denies NOTHING while reading
// to the next author as coverage. A deny rule that cannot fire is worse than no rule at all.
// (`Bash` is in session-profiles.ESCALATION_TOOLS, so the read only ever PROMPTED the operator —
// a tripwire, not a fence — and at the `bypass` posture not even that.) A file that does not
// exist needs no rule.
//
// ⚠ NOTHING IN THE APP READS IT. No production code passes `--mcp-config <spawnConfigPath()>`:
// the headless executor that did was deleted with `session-spawner.runForChannel` (2026-08-20,
// see that file's header), the SDK path takes the bearer IN MEMORY from `deviceTokenForSpawn()`,
// and manual `claude` runs are served by step 3's user-scope entry via `mcp-cli-add.js`. Verify:
//   grep -rn "spawnConfigPath\|mcp-spawn\|--mcp-config" dopl-desktop-app \
//     --include="*.js" --include="*.mjs" | grep -v node_modules
// The only remaining reader anywhere is the out-of-band live-test helper `test/live/creds.js`,
// which prefers `$DOPL_TOKEN` and treats an unreadable file as a clean skip, not a failure.
//
// `rmSync` with `force` is already a no-op on a missing file, so the common (post-migration)
// case is silent and costs one syscall.
function removeSpawnConfig() {
  try {
    fs.rmSync(spawnConfigPath(), { force: true });
    return true;
  } catch (err) {
    diag('mcp-config: spawn config removal failed', err && err.message);
    return false;
  }
}

// ── CLI entry ensure ─────────────────────────────────────────────────────────
// The three `claude mcp …` child processes live in mcp-cli-add.js. Best-effort; never throws.
// ⚠ SINGLE-FLIGHT: startup and post-sign-in both call this, and overlapping calls must coalesce
// or we mint two tokens / double-add the CLI entry.
let ensuring = null;
function ensureMcpConfig() {
  if (ensuring) return ensuring;
  ensuring = ensureMcpConfigInner().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

async function ensureMcpConfigInner() {
  try {
    // THE TOKEN FIRST, and on the sign-in alone — see `mcp-device-token-lifecycle.js › THE MINT`.
    const token = await ensureDeviceToken();
    if (!token) return; // the minting path logged WHICH of the two it was
    // ⚠ A REMOVAL, not a write. This is where an already-installed machine sheds the plaintext
    // 90-day bearer an older build left in userData/mcp-spawn.json.
    removeSpawnConfig();

    // ⚠ THE SKILLS RIDE THIS LANE, and it is the same argument the CLI entry below makes: a
    // Claude Code session that can reach the Dopl MCP server should also have arrived knowing
    // how to WAIT on it. A skill is read before the first tool call — earlier than the server's
    // own `instructions` block and much earlier than any result — which is the only moment
    // early enough to stop a session polling a channel on a timer.
    // ⚠ Best-effort and it never throws (`skill-install.js`); it also never overwrites a file
    // the operator edited. Placed after the sign-in gate and before the CLI probe so a machine
    // whose `claude` binary is unresolved still gets the skill — which is only TRUE as of
    // 2026-10-10: until the token moved above the probe, this line sat BEHIND the external-CLI
    // gate and the machines this sentence names were exactly the ones it never ran on.
    ensureDoplSkills();

    // ⚠ FROM HERE DOWN IS THE OPERATOR'S OWN CLI ENTRY, and it is the ONE part that genuinely
    // needs an external binary: `mcp-cli-add.js` runs `claude mcp …` as a child process. A Mac
    // with no external CLI has nothing to write an entry for and has already got everything
    // above, so this is a skip, not a failure — and never a reason to withhold the token.
    const bin = await spawner.getClaudeBinPath();
    if (!bin) {
      diag('mcp-config: device token ready; no external claude cli — skipping the operator CLI entry');
      return;
    }

    const probe = await probeMcpEntry(bin);
    if (probe.state === 'unknown') {
      // The CLI did not answer. Adding risks a duplicate and rewriting risks clobbering an
      // entry we cannot see, so this is the one branch that still touches nothing.
      diag('mcp-config: dopl entry unknown (cli did not answer) — leaving alone');
      return;
    }
    if (probe.state === 'present') {
      // ⚠ ORIGIN DRIFT IS A REPAIR CASE, NOT A "LEAVE ALONE" CASE (2026-08-25). Until this
      // branch existed, ANY existing entry was preserved and the ONLY thing that could refresh
      // one was a fresh mint. So an entry written while this app pointed at one origin survived
      // every later boot against a DIFFERENT one, and manual `claude` runs kept calling a dead
      // endpoint forever. Measured on this machine the day it was fixed: the app booted with
      // DOPL_APP_URL=http://localhost:3001 while the entry still read
      // `URL: http://localhost:3000/api/mcp`, and `claude mcp get dopl` reported
      // `✘ Failed to connect — ConnectionRefused`. The log line for it was, in as many words,
      // "dopl entry present/unknown — leaving alone".
      //
      // ⚠ THE SDK SESSION PATH WAS NEVER AFFECTED and that is why this hid for so long:
      // `runtime/claude/mcp.js › buildMcpServers` builds its entry in memory off the compiled-in
      // MCP_URL. (A third surface, the spawn-config FILE, self-healed by whole-body comparison;
      // it is gone — see `removeSpawnConfig`.) This CLI entry is now the ONE Dopl MCP surface
      // that lives outside this process, and origin repair is the only thing that keeps it live.
      //
      // ⚠ WHAT THIS MAY STOMP, STATED RATHER THAN HIDDEN. F-085's argument for never touching an
      // existing entry is that it may be one the OPERATOR hand-wrote with their own credential,
      // and from outside we cannot tell. That argument still holds for a MATCHING url — which is
      // why the equal case is left alone — but it cannot survive a mismatch: an entry naming a
      // Dopl MCP endpoint this app is not talking to is broken for the operator either way, and
      // a broken entry preserved out of politeness is worse than a working one they can re-point
      // by relaunching against the origin they meant.
      const drifted = probe.url && probe.url !== MCP_URL;
      if (lifecycle.mintWasFresh() || drifted) {
        // A fresh mint revoked the token the global entry carries — refresh it so manual
        // `claude` runs do not 401 until the next mint cycle. A drifted url is the same repair.
        const removed = await removeMcpEntry(bin);
        const readded = removed && (await addMcpEntry(bin, token));
        // ⚠ The REASON, never the urls: `probe.url` is read off the operator's own config and
        // MCP_URL is ours. Neither is a credential, but this file's rule is that nothing parsed
        // out of that stdout is echoed, so the log says WHICH repair ran and stops there.
        diag('mcp-config: dopl entry refreshed', drifted ? '(origin drift)' : '(fresh mint)',
          readded ? 'ok' : 'FAILED');
      } else {
        diag('mcp-config: dopl entry present and on the current origin — leaving alone');
      }
      return;
    }
    const added = await addMcpEntry(bin, token);
    diag('mcp-config: dopl entry add', added ? 'ok' : 'FAILED');
  } catch (err) {
    diag('mcp-config: ensure error', err && err.message);
  }
}

module.exports = {
  ensureMcpConfig,
  ensureDeviceToken: lifecycle.ensureDeviceToken, // the ONE mint, on the Dopl sign-in alone — `delivery-path.js`'s pre-flight
  spawnConfigPath,
  deviceTokenForSpawn: lifecycle.deviceTokenForSpawn, // the SDK path's bearer, from safeStorage — never off disk
  deviceTokenLink: lifecycle.deviceTokenLink, // device-registry.js › arm (once per sign-in)
  onDeviceTokenMinted, // device-registry.js: re-mint → link on the next beat
  clearDeviceToken: lifecycle.clearDeviceToken, // S2: sign-out teardown, LOCAL (auth-state.signOut)
  revokeDeviceToken: lifecycle.revokeDeviceToken, // F-085: sign-out teardown, SERVER-side (auth-state.signOut)
  MCP_CLIENT_TIMEOUT_MS, // Q9: ONE definition — runtime/claude/mcp.js reads it from here
};
