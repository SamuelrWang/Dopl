// Delegation fence: Dopl agents delegate by launching a visible Dopl agent, never a native sub-agent.
// A code-mode model's catalog `multi_agent_version` overrides `features.multi_agent` and no request
// precedes a spawn, so the fence is Codex's OWN catalog with it nulled (deliberate), passed as
// `model_catalog_json` — process config only (`-c`); `thread/start.config` ignores that key.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const CACHE_FILE = 'models_cache.json';
const CATALOG_FILE = 'dopl-model-catalog.json';
const DEBUG_MODELS_TIMEOUT_MS = 10000;

function usableModels(parsed) {
  const models = parsed && Array.isArray(parsed.models) ? parsed.models : null;
  if (!models || !models.length) return null;
  return models.every((m) => m && typeof m === 'object' && typeof m.slug === 'string' && m.slug) ? models : null;
}

function readCache(home) {
  try { return usableModels(JSON.parse(fs.readFileSync(path.join(home, CACHE_FILE), 'utf8'))); } catch (_) { return null; }
}

// Async: a launch runs on the Electron main thread; a synchronous child read freezes every window (CX-09).
function readDebug(bin, env, bundled) {
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      execFile(bin, ['debug', 'models'].concat(bundled ? ['--bundled'] : []), {
        env, encoding: 'utf8', timeout: DEBUG_MODELS_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
      }, (err, out) => {
        if (err) { resolve(null); return; }
        try { resolve(usableModels(JSON.parse(out))); } catch (_) { resolve(null); }
      });
    } catch (_) {
      resolve(null);
    }
  });
}

/** Codex's catalog with native delegation removed from every model. */
function delegationFree(models) {
  return models.map((m) => Object.assign({}, m, { multi_agent_version: null }));
}

async function pickModels(home, o) {
  const want = typeof o.model === 'string' ? o.model.trim() : '';
  const has = (ms) => !!ms && (!want || ms.some((m) => m.slug === want));
  const cached = readCache(home);
  if (has(cached)) return cached;
  // Offline before online: the bundled catalog knows this binary's slugs without the network.
  const bundled = await readDebug(o.bin, o.env, true);
  if (has(bundled)) return bundled;
  const fresh = await readDebug(o.bin, o.env, false);
  if (has(fresh)) return fresh;
  // A named model no source knows is refused: the override REPLACES Codex's catalog, so a missing slug
  // would start on generic defaults (no code mode, `apply_patch` or `tool_search`).
  if (want) return { missing: want };
  return cached || bundled || fresh;
}

// Writes the fenced catalog into the private home and resolves its path; rejects when none is usable.
// `opts` — `{ bin, env, model }` (`model` `''` = the platform's pick).
async function writeDelegationFreeCatalog(home, opts) {
  const o = opts || {};
  const models = await pickModels(home, o);
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

/** The app-server argv that loads it (a path, not a secret, so argv is fine). */
function catalogArgs(file) {
  // A TOML basic string; JSON's escapes are a subset TOML accepts.
  return ['-c', `model_catalog_json=${JSON.stringify(file)}`];
}

module.exports = { writeDelegationFreeCatalog, catalogArgs, readCache, CATALOG_FILE, CACHE_FILE };
