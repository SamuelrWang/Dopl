// SHARED HARNESS for the launch-directive suites — the module under test, run against stubbed
// leaves, plus the row fixture and the ids every case spells.
//
// WHY IT IS ITS OWN FILE. `launch-directives.test.mjs` crossed the 500-line cap when the
// agent-templates lane landed a resolve, a failure table, a deletion signal and a model chain on
// top of it (2026-08-23). The alternative — a second copy of the boot machinery in the new file —
// is how two suites drift into testing two different programs. Same seam and same precedent as
// `_ipc-harness.mjs` / `_classify-harness.mjs`: THE MACHINERY IS SHARED, THE CASES ARE SPLIT BY
// WHAT THEY ARE ABOUT.
//
//   launch-directives.test.mjs           the WATCHER — toggle, owner check, claim, containment,
//                                        goal, model, decision, backstop.
//   launch-directive-template.test.mjs   the TEMPLATE lane — resolve at claim time, the failure
//                                        table, E-4, the model chain's new link.
//   launch-directive-wire.test.mjs       the CONTRACT — shapes and routes that cross to the
//                                        server, each pinned against that lane's own source.
//
// ⚠ NOTHING ABOUT THE MODULE IS WRAPPED. `handle` is the real one; only its LEAVES are stubbed,
// and the two pure ones (`launch-directive-wire.js`, `session-model.js`) are injected REAL
// because both are the thing under test at their own boundaries.
//
// ⚠ THIS FILE DECLARES NO `test()`. It matches the runner's `test/**/*.mjs` glob and runs as an
// empty suite, exactly as the other `_`-prefixed harnesses do.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const MAIN = join(HERE, "..", "main");
export const require_ = createRequire(import.meta.url);

export const SRC = readFileSync(join(MAIN, "launch-directives.js"), "utf8");
export const wire = require_(join(MAIN, "launch-directive-wire.js"));

export const WS = "11111111-1111-4111-8111-111111111111";
export const CH = "22222222-2222-4222-8222-222222222222";
export const TH = "33333333-3333-4333-8333-333333333333";
export const ME = "44444444-4444-4444-8444-444444444444";
export const OTHER = "55555555-5555-4555-8555-555555555555";
export const DID = "66666666-6666-4666-8666-666666666666";

/** A pending directive row, as the server would write it (snake_case, like a realtime frame). */
export const row = (over = {}) => ({
  id: DID,
  workspace_id: WS,
  channel_id: CH,
  task_id: TH,
  operator_user_id: ME,
  goal: "Draft the release notes",
  model: "claude-opus-5",
  status: "pending",
  ...over,
});

/**
 * The module, run against stubbed leaves. `main/api.js` reaches `auth` and Electron, so it
 * cannot be required under `node --test`; everything else is stubbed for control rather than
 * necessity, and `launch-directive-wire.js` + `session-model.js` are injected REAL because both
 * are pure and both are the thing under test at their own boundaries.
 */
export function boot(over = {}) {
  const cfg = {
    enabled: true,
    user: ME,
    watched: { id: CH, name: "General", toolProfile: "full" },
    launch: async () => ({ agentId: "a1b2c3d4", sessionId: "s1" }),
    claimAnswer: { ok: true, status: 200, json: { ok: true, directive: null } },
    ...over,
  };
  const posts = [];
  const gets = [];
  const arms = [];
  const logged = [];
  const resolves = [];
  const stub = (id) => {
    if (id === "./api") {
      return {
        apiFetch: async (path, opts) => {
          if ((opts.method || "GET") === "GET") {
            gets.push({ path, opts });
            return { ok: true, status: 200, json: async () => ({ directives: cfg.pending || [] }) };
          }
          posts.push({ path, workspaceId: opts.workspaceId, body: opts.body });
          if (path === wire.ROUTES.claim) {
            const a = cfg.claimAnswer;
            if (a.throws) throw new Error(a.throws);
            // ⚠ THE CAS ANSWERS WITH WHAT IT GRANTED, and the module re-narrows from THAT rather
            // than from the frame — so by default the stub grants exactly the row it was asked
            // about. `cfg.claimed` overrides it, which is how the "claim wins over the frame"
            // case makes the two disagree on purpose.
            const granted = cfg.claimed || { ...(cfg.lastFrame || row()), status: "claimed" };
            const json = a.json && a.json.directive === null
              ? { ...a.json, directive: granted }
              : a.json;
            return { ok: a.ok, status: a.status, json: async () => json };
          }
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        },
      };
    }
    if (id === "./realtime") {
      return {
        setDirectives: (on, handler) => { arms.push({ on, handler: typeof handler }); },
        isWorkspaceHealthy: () => cfg.healthy !== false,
        desiredWorkspaceIds: () => [WS],
      };
    }
    if (id === "./channel-prefs") {
      return {
        getOrchestratorLaunch: () => cfg.enabled === true,
        launchStartModes: () => ({ tools: "bypass", messages: "auto_both" }),
        getLaunchModel: () => "claude-sonnet-5",
      };
    }
    if (id === "./targeting") {
      // The REAL question this stands in for is "what does main think this channel allows".
      // Answering off the DTO is the behaviour under test in §3.
      return { resolveToolProfile: (c) => (c && c.toolProfile) || "read_only" };
    }
    if (id === "./launch-directive-wire") return wire;
    if (id === "./session-model") return require_(join(MAIN, "session-model.js"));
    // ⚠ THE TEMPLATE RESOLVE IS STUBBED AT ITS SEAM, not faked at the transport. The real module
    // is `main/template-resolve.js` and it rides `api.js`, which reaches Electron — so what is
    // controlled here is exactly its documented ANSWER SET (`{ok:true, template}` /
    // `{ok:false, reason:'no-template'|'busy'}`), driven for real in `session-launch-template.
    // test.mjs`. What THIS file asks is what the WATCHER does with each answer.
    if (id === "./template-resolve") {
      return {
        resolveTemplate: async (templateId, workspaceId) => {
          resolves.push({ templateId, workspaceId });
          return cfg.resolve || { ok: true, template: { name: "Code Auditor", model: null } };
        },
      };
    }
    // ⚠ THE **REAL** `templateModel`, evaluated out of its own source. It cannot be `require`d
    // under `node --test` (`session-launch-op.js` pulls `./diag`, which pulls Electron), and a
    // hand-written copy here would make the two lanes' model chains agree only in this file —
    // which is the drift the shared helper exists to prevent.
    if (id === "./session-launch-op") return launchOp;
    if (id === "./diag") return { diag: (...p) => logged.push(p.join(" ")) };
    throw new Error(`unexpected require: ${id}`);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stub, mod, mod.exports);
  const api = mod.exports;
  api.start({
    getUserId: () => cfg.user,
    launch: (spec) => { cfg.lastSpec = spec; return cfg.launch(spec); },
    watchedChannel: () => cfg.watched,
    workspaces: () => [WS],
  });
  // ⚠ THE FRAME IS RECORDED BEFORE IT IS HANDED IN, so the claim stub above can grant the row it
  // was actually asked about. Nothing about the module is wrapped — `handle` is the real one.
  const handle = (frame, ws) => { cfg.lastFrame = frame; return api.handle(frame, ws); };
  return { api: { ...api, handle }, cfg, posts, gets, arms, logged, resolves };
}

/**
 * `session-launch-op.js`, evaluated once out of its own source with Electron's two dependencies
 * stubbed. ⚠ ONLY `templateModel` IS USED FROM IT, and it is used rather than copied because it
 * is the ONE statement of "a template's model becomes an alias, or '' so the chain continues" —
 * the button lane reads it too, and a second copy here would let the two lanes disagree while
 * both suites stayed green.
 */
export const launchOp = (() => {
  const src = readFileSync(join(MAIN, "session-launch-op.js"), "utf8");
  const mod = { exports: {} };
  const stub = (id) => {
    if (id === "./ipc-guards") return require_(join(MAIN, "ipc-guards.js"));
    if (id === "./agent-id") return require_(join(MAIN, "agent-id.js"));
    if (id === "./diag") return { diag: () => {} };
    throw new Error(`session-launch-op asked for ${id} at module scope`);
  };
  new Function("require", "module", "exports", src)(stub, mod, mod.exports);
  return mod.exports;
})();

export const claimPosts = (h) => h.posts.filter((p) => p.path === wire.ROUTES.claim);
export const decidePosts = (h) => h.posts.filter((p) => p.path === wire.ROUTES.decide);

