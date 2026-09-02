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
// ⚠ 2026-08-31 (§1 split): the two authenticated calls left `launch-directives.js` for
// `launch-directive-calls.js` — the file had reached EXACTLY 500 lines and could not take another
// comment. The harness evaluates the REAL module with the SAME `./api` stub rather than faking
// `claim` / `decide`, because those two carry behaviour this suite asserts: which HTTP statuses
// are an ordinary lost race, the three accepted claim envelopes, and the re-narrow through
// `wire.directiveFrom`. A stubbed pair would have moved all of that out of the suite's reach in a
// change whose whole point was that nothing moved.
export const CALLS_SRC = readFileSync(join(MAIN, "launch-directive-calls.js"), "utf8");
// ⚠ 2026-09-01 (the agent-management kinds): the REAL `directive-agent-ops.js`, evaluated with
// stubbed leaves, exactly as `launch-directive-calls.js` above and for the same reason. It is
// where the two new verbs are DECIDED — the end verdict, the rename write, and which wire word
// each failure becomes — so faking it would move the whole feature out of the suite's reach.
// ⚠ ITS TWO REAL DEPENDENCIES ARE NOT STUBBED: `agent-self-ops.js` (the verdict table and the
// rename primitive, both electron-free and both shared with the in-process tool) and
// `launch-directive-wire.js`. What IS stubbed is `session-engine.js` (the live registry) and
// `agent-names.js` (an electron-store), which is the same seam `./targeting` is stubbed at.
export const AGENT_OPS_SRC = readFileSync(join(MAIN, "directive-agent-ops.js"), "utf8");
// ⚠ `spawn` MOVED OUT OF `launch-directives.js` ON 2026-09-01 (T24, the §1 cap) and is
// evaluated here the same way `directive-agent-ops.js` is: through the SAME stub `require`, so
// the containment inputs every case in this suite asserts are the real ones.
export const SPAWN_SRC = readFileSync(join(MAIN, "launch-directive-spawn.js"), "utf8");
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
    // ⚠ THE LIVE REGISTRY, as `session-engine.js › listLiveSessions` projects it. Empty by
    // default, so the ordinary `no-session` answer is what a case gets unless it says otherwise.
    live: [],
    // What `controlByTask` answers. `{ok:true}` unless a case makes the session settle mid-flight.
    control: { ok: true },
    // What `agent-names.js › rename` answers: the STORED string, or null for a sanitizer refusal.
    renameAnswer: undefined,
    claimAnswer: { ok: true, status: 200, json: { ok: true, directive: null } },
    ...over,
  };
  const posts = [];
  const gets = [];
  const arms = [];
  const logged = [];
  const controls = []; // every `session-engine.controlByTask` call the lane made
  const names = [];    // every `agent-names` write the lane made
  const modes = [];    // every `session-engine.setModeByTask` call the lane made (2026-09-01)
  const resolves = [];
  const stub = (id) => {
    if (id === "./api") {
      return {
        apiFetch: async (path, opts) => {
          if ((opts.method || "GET") === "GET") {
            gets.push({ path, opts });
            // ⚠ THE PINNED STARTUP CONTEXT (2026-09-01, T81) — a SECOND GET on this lane, and it
            // is answered separately because it is ENRICHMENT rather than a decision: the spawn
            // degrades to absent on any failure, so a stub that answered every GET with the
            // backstop's `{ directives }` envelope would leave that whole branch untestable while
            // looking like it worked. ⚠ THE DEFAULT IS A FAILURE-SHAPED ANSWER, deliberately, so
            // every case in every OTHER suite keeps producing the pre-T81 spawn spec byte for
            // byte; `cfg.startupContext` is how `launch-startup-context.test.mjs` opts in.
            if (path === "/api/knowledge/startup-context") {
              const a = cfg.startupContext || { ok: true, body: {} };
              if (a.throws) throw new Error(a.throws);
              return { ok: a.ok !== false, status: a.status || 200, json: async () => a.body || {} };
            }
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
        // ⚠ THE CHANNEL'S AGENT-CHAINING SETTING (2026-08-31, Samuel's ruling). Default here is
        // FALSE — the one-generation bound — so every existing case in this suite keeps asserting
        // the shipped behaviour; `cfg.chain` opts a case in, and `launch-chain.test.mjs` drives it.
        getAgentChain: () => cfg.chain === true,
        // ⚠ THE CEILING THE `set_agent_mode` KIND CLAMPS TO (2026-09-01). It is the operator's
        // OWN durable, human-set channel posture, and the whole safety argument of that kind is
        // that nothing an orchestrator writes may exceed it. The default here is the WIDEST pair
        // so an unrelated case never trips the clamp; `cfg.ceiling` is how a clamp case sets one.
        getLaunchPosture: () => cfg.ceiling || { tools: "bypass", messages: "auto_both", model: null },
        // ⚠ THE WINDOWLESS MESSAGE FLOOR, REAL RATHER THAN STUBBED (2026-09-01, T24). It is the
        // rule the clamp composes with — clamp, THEN floor — and a fake would let this suite go
        // green about an order that is the contract. The real function is pure.
        windowlessMessageMode: (_c, picked) => (picked === "auto_outbound" || picked === "auto_both"
          ? "auto_both" : "auto_inbound"),
      };
    }
    if (id === "./targeting") {
      // The REAL question this stands in for is "what does main think this channel allows".
      // Answering off the DTO is the behaviour under test in §3.
      return { resolveToolProfile: (c) => (c && c.toolProfile) || "read_only" };
    }
    if (id === "./launch-directive-wire") return wire;
    // ⚠ THE SHARED POSTURE BOUND (2026-09-01, T24) — the REAL module, not a stub. It is pure (no
    // require, no clock, no store) and it is the rule under test on both lanes; a fake here would
    // let the suite go green about a clamp that never happened.
    if (id === "./launch-posture") return require_(join(MAIN, "launch-posture.js"));
    if (id === "./launch-directive-calls") {
      const m = { exports: {} };
      new Function("require", "module", "exports", CALLS_SRC)(stub, m, m.exports);
      return m.exports;
    }
    // ⚠ 2026-08-31 (port wave D): WHICH RUNTIME this channel's agents run on. Stubbed at its seam
    // like `./targeting` above — the real module opens an electron-store — and answering `''`
    // (the DEFAULT adapter, and what every pre-port launch resolved to) is what keeps the specs
    // this file asserts byte-identical to the ones that shipped. The INHERITANCE itself is
    // asserted in `test/launch-chain.test.mjs`, against a channel that really has a pick.
    if (id === "./channel-runtime") return { getChannelRuntime: () => cfg.channelRuntime || "" };
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
    // ── ⚠ THE AGENT-MANAGEMENT KINDS (2026-09-01) ───────────────────────────────────────────
    if (id === "./launch-directive-spawn") {
      const m = { exports: {} };
      new Function("require", "module", "exports", SPAWN_SRC)(stub, m, m.exports);
      return m.exports;
    }
    if (id === "./directive-agent-ops") {
      const m = { exports: {} };
      new Function("require", "module", "exports", AGENT_OPS_SRC)(stub, m, m.exports);
      return m.exports;
    }
    if (id === "./agent-self-ops") return require_(join(MAIN, "agent-self-ops.js"));
    if (id === "./session-engine") {
      return {
        listLiveSessions: () => cfg.live,
        controlByTask: (a) => { controls.push(a); return cfg.control; },
        // ⚠ THE LIVE MODE OP, STUBBED AT ITS SEAM (2026-09-01) — the real one is
        // `session-reopen.js › setModeByTask`, where the windowless MESSAGE floor and the
        // reducer's fail-closed coercion live, and it is driven for real in
        // `session-mode-floor.test.mjs`. What THIS harness controls is which answer comes back,
        // so a case can ask what the DIRECTIVE lane does with each.
        setModeByTask: (a) => { modes.push(a); return cfg.setMode || { ok: true }; },
      };
    }
    if (id === "./agent-names") {
      return {
        // ⚠ THE STORE'S OWN CONTRACT, not a sanitizer: `rename` answers the STORED string or
        // `null` when it refuses, and `clear` answers nothing. The real sanitizer is driven for
        // real in `agent-self-ops.test.mjs`; what THIS harness controls is which answer comes
        // back, so a case can ask what the DIRECTIVE lane does with each.
        rename: (agentId, name) => {
          names.push({ op: "rename", agentId, name });
          return cfg.renameAnswer !== undefined ? cfg.renameAnswer : String(name);
        },
        clear: (agentId) => { names.push({ op: "clear", agentId }); },
      };
    }
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
  return { api: { ...api, handle }, cfg, posts, gets, arms, logged, resolves, controls, names, modes };
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

