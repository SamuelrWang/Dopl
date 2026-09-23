// THE DELEGATION FENCE FOR CODE-MODE MODELS — a Dopl-owned model catalog with native sub-agents off.
//
// 🔒 ⚠ **ON DOPL AN AGENT DELEGATES BY LAUNCHING A REAL, VISIBLE DOPL AGENT** —
// `dopl_channel(op="manage", action="launch")` — never by a runtime's own sub-agent, which is a
// fresh session nobody can see, that does not inherit the profile's bound, and that Dopl cannot
// stop. Claude removes `Agent` on every profile (`runtime/claude/tools.js › FULL_BUILTIN_BOUND`);
// this is the Codex half.
//
// ⚠ WHY A CATALOG AND NOT A FEATURE FLAG (MEASURED 2026-09-22, codex-cli 0.155.1). `features.
// multi_agent = false` removes the delegation tools only on a model whose catalog entry carries no
// `multi_agent_version` (gpt-5.5). Every `code_mode_only` model ships `multi_agent_version: "v2"`
// (gpt-6-*, gpt-5.6-sol/terra) or `"v1"` (gpt-5.6-luna), and the catalog value WINS: with
// `multi_agent`, `multi_agent_v2` (bool AND `{ enabled = false }` table), `code_mode`,
// `agents.max_depth = 0` all set, the `collaboration` namespace (`spawn_agent`, `send_message`,
// `followup_task`, `wait_agent`, `interrupt_agent`, `list_agents`) was still offered, and a
// scripted `spawn_agent` call STARTED A CHILD THREAD that made its own model request. No server
// request precedes a spawn, so there is no approval to refuse it at either.
// `model_catalog_json` pointing at a copy of Codex's OWN catalog with `multi_agent_version: null`
// is what works — and only as PROCESS config (`-c` on `codex app-server`); the same key in
// `thread/start.config` is ignored. Measured with it: no `collaboration` namespace, no
// multi-agent instructions in the prompt, and a forced `spawn_agent` answers
// `unsupported call` with ONE loaded thread and no child model request.
//
// ⚠ THE SOURCE IS CODEX'S OWN CATALOG, NEVER A DOPL-WRITTEN ONE, and only `multi_agent_version`
// is changed. In order: `models_cache.json` in the private home (what Codex itself fetched — the
// model picker's `model/list` refreshes it, in the same home); if that lacks the session's model,
// `codex debug models --bundled` (offline, the catalog this binary ships); then `codex debug
// models` (Codex's own networked refresh).
// ⚠ WHY THE MODEL MATTERS (MEASURED): the override REPLACES the catalog, and a slug missing from it
// starts on Codex's generic defaults — no code mode, no `apply_patch`, no `tool_search`. Not a
// widening (delegation stays off), but a degraded agent, so the source that knows the model wins.
// ⚠ NOTHING USABLE → THE LAUNCH THROWS: a session that would silently regain delegation is worse
// than one that does not start.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CACHE_FILE = 'models_cache.json';
const CATALOG_FILE = 'dopl-model-catalog.json';
const BUNDLED_TIMEOUT_MS = 10000;

function usableModels(parsed) {
  const models = parsed && Array.isArray(parsed.models) ? parsed.models : null;
  if (!models || !models.length) return null;
  return models.every((m) => m && typeof m === 'object' && typeof m.slug === 'string' && m.slug) ? models : null;
}

function readCache(home) {
  try { return usableModels(JSON.parse(fs.readFileSync(path.join(home, CACHE_FILE), 'utf8'))); } catch (_) { return null; }
}

function readDebug(bin, env, bundled) {
  if (!bin) return null;
  try {
    const out = execFileSync(bin, ['debug', 'models'].concat(bundled ? ['--bundled'] : []), {
      env, encoding: 'utf8', timeout: BUNDLED_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    });
    return usableModels(JSON.parse(out));
  } catch (_) {
    return null;
  }
}

/** Codex's catalog with native delegation removed from every model. */
function delegationFree(models) {
  return models.map((m) => Object.assign({}, m, { multi_agent_version: null }));
}

function pickModels(home, o) {
  const want = typeof o.model === 'string' ? o.model.trim() : '';
  const has = (ms) => !!ms && (!want || ms.some((m) => m.slug === want));
  const cached = readCache(home);
  if (has(cached)) return cached;
  // Offline before online: the catalog this binary ships knows its own slugs, and a launch should
  // not wait on the network for a model it already describes.
  const bundled = readDebug(o.bin, o.env, true);
  if (has(bundled)) return bundled;
  const fresh = readDebug(o.bin, o.env, false);
  if (has(fresh)) return fresh;
  // ⚠ **A NAMED MODEL NO SOURCE KNOWS IS REFUSED, NOT DEGRADED (2026-09-22).** This answered
  // `cached || bundled || fresh` — a catalog WITHOUT the session's model — and the override then
  // REPLACED Codex's catalog, so a model `model/list` offered (a brand-new one above all) started
  // on generic defaults: no code mode, no `apply_patch`, no `tool_search`. Not a widening, but a
  // quietly worse agent than the one the operator picked. `model/list` refreshes the same
  // `models_cache.json` in this home, so reaching here means Codex's own catalog is behind its
  // own picker; the launch says so instead of guessing an entry.
  if (want) return { missing: want };
  return cached || bundled || fresh;
}

/**
 * Write the fenced catalog into the private home and answer its path.
 * `opts.bin` — the resolved codex binary (for the fallbacks); `opts.env` — its environment;
 * `opts.model` — the session's model slug, `''` for the platform's pick.
 */
function writeDelegationFreeCatalog(home, opts) {
  const o = opts || {};
  const models = pickModels(home, o);
  if (models && models.missing) {
    throw new Error(`Codex's own model catalog has no entry for "${models.missing}" (checked its cache, `
      + 'its built-in list and a fresh fetch), so Dopl cannot turn off Codex\'s own sub-agents for it '
      + 'without starting it on generic defaults — refusing the launch. Pick another model, or retry once Codex has refreshed.');
  }
  if (!models) {
    throw new Error('Dopl could not read Codex\'s model catalog, so it cannot turn off Codex\'s own '
      + 'sub-agents for this session — refusing the launch rather than starting one that can delegate invisibly.');
  }
  const file = path.join(home, CATALOG_FILE);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ models: delegationFree(models) }), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

/** The app-server argv that loads it. ⚠ A PATH, NOT A SECRET, so argv is the right lane. */
function catalogArgs(file) {
  // A TOML basic string; JSON's escapes are a subset TOML accepts.
  return ['-c', `model_catalog_json=${JSON.stringify(file)}`];
}

module.exports = { writeDelegationFreeCatalog, catalogArgs, delegationFree, readCache, CATALOG_FILE, CACHE_FILE };
