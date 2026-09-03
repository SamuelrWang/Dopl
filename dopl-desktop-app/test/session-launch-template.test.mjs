// THE TEMPLATE LAUNCH LANE — `main/session-launch-op.js` + `main/template-resolve.js`.
// (2026-08-22, the agent-templates wave, spec §3b/§3c/§3d.)
//
// ⚠ NOTHING IN THE TREE PINNED THIS PAYLOAD'S SHAPE BEFORE THIS FILE.
// `test/preload-parity.test.mjs` pins OP NAMES, not payloads, so adding a field to
// `sessions:launch` was invisible to every existing suite. This is that pin, plus the failure
// table the spec spells F-1…F-6 and the model precedence chain.
//
// METHOD: the SHIPPED launch body, evaluated against a stub `require` and driven for real. The
// transport is faked at exactly ONE seam (`./api › apiFetch`), because everything above it —
// the refusal mapping, the narrowing whitelist, the approval gate, the precedence chain — is
// what is under test.
//
// Run: `node --test dopl-desktop-app/test/session-launch-template.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");

const CH = "11111111-1111-4111-8111-111111111111";
const THREAD = "22222222-2222-4222-8222-222222222222";
const TPL = "33333333-3333-4333-8333-333333333333";
const WS = "ws-1";

const RESOLVED = {
  name: "Code Auditor",
  instructions: "Audit the diff.",
  model: null,
  fields: [{ key: "repo", value: "acme/api" }],
  knowledgeBases: [{ id: "kb-1", name: "Handbook" }],
  authoredByCaller: true,
};

/**
 * Boot the REAL launch body over a faked transport and a faked engine.
 * `api` decides what `/resolve` answers; `approved` is the machine-local store's verdict.
 */
function boot(api = {}, opts = {}) {
  const launches = [];
  const approvals = [];
  const requests = [];
  const stub = (id) => {
    if (id === "./ipc-guards") return require(join(MAIN, "ipc-guards.js"));
    if (id === "./agent-id") return require(join(MAIN, "agent-id.js"));
    if (id === "./diag") return { diag: () => {} };
    if (id === "./session-model") return require(join(MAIN, "session-model.js"));
    if (id === "./session-telemetry") return require(join(MAIN, "session-telemetry.js"));
    if (id === "./api") {
      return {
        apiFetch: async (path, o) => {
          requests.push({ path, ...o });
          if (typeof api.throws === "function") throw api.throws();
          return {
            ok: api.status === undefined || (api.status >= 200 && api.status < 300),
            status: api.status === undefined ? 200 : api.status,
            json: async () => (api.body === undefined ? RESOLVED : api.body),
          };
        },
      };
    }
    if (id === "./template-resolve") return resolveMod.exports;
    if (id === "./channel-listener") return { watchedChannel: () => ({ channel: { myAgentToolProfile: "full" } }) };
    if (id === "./targeting") return { resolveToolProfile: () => "full", resolveLaunchToolProfile: () => "full" }; // ⚠ BOTH READS — the lane takes the LAUNCH one since ruling B7; `channel-agent-profile.test.mjs` drives the real rule
    if (id === "./channel-prefs") {
      return {
        launchStartModes: () => ({ tools: "manual", messages: "auto_inbound" }),
        getLaunchModel: () => opts.channelModel || null,
        isTemplateApproved: () => opts.approved === true,
        approveTemplate: (t) => { approvals.push(t); return opts.storeWrites !== false; },
      };
    }
    if (id === "./session-engine") {
      return {
        launchRequesterSession: async (spec) => {
          launches.push(spec);
          return { agentId: "ag-1", sessionId: "s-1" };
        },
      };
    }
    // 2026-08-31 (port wave D) — WHICH RUNTIME this channel's agents launch on. ⚠ Stubbed at its
    // seam like `./channel-prefs` above (the real module opens an electron-store), and answering
    // `''` is the DEFAULT adapter, which is what every launch resolved to before the port — so
    // the specs this file asserts stay byte-identical to the ones that shipped.
    if (id === "./channel-runtime") {
      return { normalizeRuntimeId: (v) => (v === "codex" || v === "cursor" ? v : ""), getChannelRuntime: () => "" };
    }
    throw new Error("unexpected require: " + id);
  };
  const resolveMod = { exports: {} };
  new Function("require", "module", "exports", read("template-resolve.js"))(
    stub, resolveMod, resolveMod.exports
  );
  const mod = { exports: {} };
  new Function("require", "module", "exports", read("session-launch-op.js"))(stub, mod, mod.exports);
  return { ...mod.exports, resolve: resolveMod.exports, launches, approvals, requests };
}

const payload = (over = {}) => ({
  channelId: CH, taskId: THREAD, workspaceId: WS, threadTitle: "T", ...over,
});

// ── 0. THE BLANK LANE IS UNTOUCHED ───────────────────────────────────────────

test("no templateId ⇒ NO resolve at all, and `context.template` is null", async () => {
  const m = boot();
  const res = await m.launchFromButton(payload());
  assert.deepEqual(res, { ok: true, agentId: "ag-1", sessionId: "s-1" });
  assert.deepEqual(m.requests, [], "a blank launch must not cost a round trip");
  assert.equal(m.launches[0].context.template, null);
});

test("`null` and `''` are also NO TEMPLATE — the blank lane has three spellings", async () => {
  for (const templateId of [null, "", undefined]) {
    const m = boot();
    assert.equal((await m.launchFromButton(payload({ templateId }))).ok, true);
    assert.deepEqual(m.requests, [], JSON.stringify(templateId));
  }
});

// ── 1. THE FAILURE TABLE, F-1 … F-6 ──────────────────────────────────────────

test("F-1 / F-2: a 404 REFUSES with `no-template` — deleted and invisible are one answer", async () => {
  // ⚠ THE ENDPOINT IS 404-NEVER-403 SO THE DIFFERENCE IS NOT OBSERVABLE, and the desktop must
  // not try to reconstruct it. One word for both.
  const m = boot({ status: 404 });
  assert.deepEqual(await m.launchFromButton(payload({ templateId: TPL })), {
    ok: false, reason: "no-template",
  });
  assert.equal(m.launches.length, 0, "REFUSE, never degrade to a blank agent");
});

// ⚠ T35 — THE WORD DOES NOT MOVE (one `reason` for all three causes); only the SERVER's own classification
// travels; anything that is not TWO NON-EMPTY STRINGS falls to the plain 404. `main/template-resolve.js ›
// resolveTemplate` carries why that is not an oracle; `undefined` below is a non-envelope body (an older server).
test("T35: a classified 404 carries the place; every other 404 is byte-identical to before", async () => {
  const shelf = { name: "Code Auditor", label: "your personal shelf" }, at = (el) => boot({ status: 404, body: el === undefined ? undefined : { error: { details: { elsewhere: el } } } });
  assert.deepEqual(await at(shelf).resolve.resolveTemplate(TPL, WS), { ok: false, reason: "no-template", elsewhere: shelf });
  for (const el of [undefined, {}, { name: "x" }, { label: "y" }, { name: "", label: "y" }, "shelf", 7, null])
    assert.deepEqual(await at(el).resolve.resolveTemplate(TPL, WS), { ok: false, reason: "no-template" }, JSON.stringify(el ?? null));
});

test("F-3: a timeout / dead socket REFUSES with the EXISTING word `busy`", async () => {
  const m = boot({ throws: () => Object.assign(new Error("aborted"), { name: "AbortError" }) });
  assert.deepEqual(await m.launchFromButton(payload({ templateId: TPL })), {
    ok: false, reason: "busy",
  });
  assert.equal(m.launches.length, 0);
});

test("F-4: a 5xx is the same class — `busy`, and so is every other non-2xx", async () => {
  for (const status of [500, 502, 401, 403, 400]) {
    const m = boot({ status });
    const res = await m.launchFromButton(payload({ templateId: TPL }));
    // ⚠ A 4xx IS `busy`, NOT `no-template`: none of them means the template is GONE, and
    // "reload the list" would send the operator to fix the wrong thing.
    assert.deepEqual(res, { ok: false, reason: "busy" }, `HTTP ${status}`);
  }
});

test("F-5: an UNKNOWN template model DEGRADES to the next link, it never refuses", async () => {
  const m = boot({ body: { ...RESOLVED, model: "gpt-9-turbo" } }, { channelModel: "claude-opus-5" });
  assert.equal((await m.launchFromButton(payload({ templateId: TPL }))).ok, true);
  assert.equal(m.launches[0].model, "opus", "the operator's own channel pick is not thrown away");
});

test("F-6: a NAME-ONLY template LAUNCHES — an empty template is a real configuration", async () => {
  const m = boot({
    body: { name: "Bare", instructions: null, model: null, fields: [], knowledgeBases: [], authoredByCaller: true },
  });
  const res = await m.launchFromButton(payload({ templateId: TPL }));
  assert.equal(res.ok, true);
  assert.equal(m.launches[0].context.template.name, "Bare");
  assert.equal(m.launches[0].context.template.instructions, null);
});

test("a PRESENT but MALFORMED id refuses rather than silently launching blank", async () => {
  // ⚠ F-1's argument applied one step earlier: the operator picked an identity, and a blank
  // agent silently wearing none is worse than a refusal they can see.
  const m = boot();
  assert.deepEqual(await m.launchFromButton(payload({ templateId: "../../etc/passwd" })), {
    ok: false, reason: "no-template",
  });
  assert.deepEqual(m.requests, [], "a non-UUID never reaches the network");
});

test("a 200 whose body is not a usable template is `no-template`, not a blank launch", async () => {
  for (const body of [null, {}, { name: "" }, "nonsense"]) {
    const m = boot({ body });
    assert.deepEqual(await m.launchFromButton(payload({ templateId: TPL })), {
      ok: false, reason: "no-template",
    }, JSON.stringify(body));
  }
});

// ── 2. THE REQUEST ITSELF ────────────────────────────────────────────────────

test("the resolve is a GET on the launch contract, 5s, no-store, workspace-scoped", async () => {
  const m = boot();
  await m.launchFromButton(payload({ templateId: TPL }));
  assert.equal(m.requests.length, 1);
  const r = m.requests[0];
  assert.equal(r.path, `/api/agent-templates/${TPL}/resolve`);
  assert.equal(r.method, "GET");
  assert.equal(r.workspaceId, WS);
  assert.equal(r.noStore, true);
  // ⚠ 5000, NOT `launch-directives.js`'s 15000: this one is held open by a BUTTON CLICK.
  assert.equal(r.timeoutMs, 5000);
  assert.equal(r.timeoutMs, m.resolve.TEMPLATE_RESOLVE_TIMEOUT_MS);
});

test("the payload is NARROWED to a literal whitelist — a new server field is DROPPED", async () => {
  const m = boot({ body: { ...RESOLVED, createdBy: "user-9", id: TPL, visibility: "team" } });
  await m.launchFromButton(payload({ templateId: TPL }));
  const t = m.launches[0].context.template;
  assert.deepEqual(Object.keys(t).sort(), [
    "authoredByCaller", "fields", "instructions", "knowledgeBases", "model", "name",
  ]);
  // ⚠ OWNERSHIP INFORMATION MUST NOT RIDE A LAUNCH PAYLOAD. `authoredByCaller` is a COMPUTED
  // BOOLEAN precisely so a raw creator id never has to.
  assert.equal("createdBy" in t, false);
});

// ── 3. FIRST-USE APPROVAL (OQ-3) ─────────────────────────────────────────────

test("a FOREIGN template's first launch on this machine asks, and starts nothing", async () => {
  const m = boot({ body: { ...RESOLVED, authoredByCaller: false } }, { approved: false });
  const res = await m.launchFromButton(payload({ templateId: TPL }));
  assert.equal(res.ok, false);
  assert.equal(res.reason, "template-approval");
  // ⚠ THE INSTRUCTIONS RIDE BACK so the sheet shows THE TEXT MAIN RESOLVED, verbatim. An
  // approval over a body the renderer fetched separately approves a different document.
  assert.deepEqual(res.template, { name: "Code Auditor", instructions: "Audit the diff." });
  assert.equal(m.launches.length, 0, "the question is asked BEFORE anything spawns");
});

test("…and once approved on this machine it launches without asking again", async () => {
  const m = boot({ body: { ...RESOLVED, authoredByCaller: false } }, { approved: true });
  assert.equal((await m.launchFromButton(payload({ templateId: TPL }))).ok, true);
  assert.equal(m.launches[0].context.template.authoredByCaller, false, "still marked foreign");
});

test("an OWN template is never gated — the approval store is not even consulted", async () => {
  const m = boot({ body: { ...RESOLVED, authoredByCaller: true } }, { approved: false });
  assert.equal((await m.launchFromButton(payload({ templateId: TPL }))).ok, true);
});

test("⚠ IT FAILS FOREIGN: a missing `authoredByCaller` is treated as somebody else's", async () => {
  const body = { ...RESOLVED };
  delete body.authoredByCaller;
  const m = boot({ body }, { approved: false });
  assert.equal((await m.launchFromButton(payload({ templateId: TPL }))).reason, "template-approval");
});

test("approveTemplate is UUID-gated, records, and RETURNS THE VERDICT", async () => {
  const m = boot();
  assert.deepEqual(m.approveTemplate({ templateId: TPL }), { ok: true });
  assert.deepEqual(m.approvals, [TPL]);
  assert.deepEqual(m.approveTemplate({ templateId: "nope" }), { ok: false });
  assert.deepEqual(m.approveTemplate({}), { ok: false });
  assert.deepEqual(m.approvals, [TPL], "a bad id records nothing");
  // ⚠ AN UNWRITABLE STORE IS NOT AN APPROVAL. Swallowing that makes the next launch ask again,
  // which reads as a broken modal unless the SPA can say what happened.
  const dead = boot({}, { storeWrites: false });
  assert.deepEqual(dead.approveTemplate({ templateId: TPL }), { ok: false });
});

// ── 4. THE MODEL PRECEDENCE CHAIN ────────────────────────────────────────────

test("CHAIN: overrides.model > template.model > channelPrefs > the SDK's own pick", async () => {
  const withTemplateModel = { ...RESOLVED, model: "claude-sonnet-5" };
  const cases = [
    // [template body, channel pick, overrides, expected alias]
    [RESOLVED, null, undefined, "default"],
    [RESOLVED, "claude-opus-5", undefined, "opus"],
    [withTemplateModel, "claude-opus-5", undefined, "sonnet"],
    [withTemplateModel, "claude-opus-5", { model: "claude-haiku-4-5-20251001" }, "haiku"],
    [RESOLVED, null, { model: "claude-fable-5" }, "fable"],
  ];
  for (const [body, channelModel, overrides, expected] of cases) {
    const m = boot({ body }, { channelModel });
    await m.launchFromButton(payload({ templateId: TPL, overrides }));
    assert.equal(m.launches[0].model, expected,
      `${body.model} / ${channelModel} / ${JSON.stringify(overrides)}`);
  }
});

test("a template model written as an ALIAS works too — both vocabularies are accepted", async () => {
  const m = boot({ body: { ...RESOLVED, model: "haiku" } }, { channelModel: "claude-opus-5" });
  await m.launchFromButton(payload({ templateId: TPL }));
  assert.equal(m.launches[0].model, "haiku");
});

test("a BLANK launch still honours the sheet's model override", async () => {
  // The sheet opens on `Blank agent` too, and dropping the pick there would be a control that
  // silently does nothing.
  const m = boot({}, { channelModel: "claude-opus-5" });
  await m.launchFromButton(payload({ overrides: { model: "claude-sonnet-5" } }));
  assert.equal(m.launches[0].model, "sonnet");
  assert.equal(m.launches[0].context.template, null);
});

test("an UNKNOWN override model falls THROUGH, exactly as an unknown template model does", async () => {
  const m = boot({}, { channelModel: "claude-opus-5" });
  await m.launchFromButton(payload({ overrides: { model: "gpt-9" } }));
  assert.equal(m.launches[0].model, "opus");
});

// ── 5. THE FIELD OVERRIDES, AND THE CHARSET MAIN IS THE ONLY VALIDATOR OF ────

test("overrides.fields REPLACE the template's fields — never merged", async () => {
  const m = boot();
  await m.launchFromButton(payload({
    templateId: TPL,
    overrides: { fields: [{ key: "repo", value: "acme/web" }, { key: "severity", value: "high" }] },
  }));
  assert.deepEqual(m.launches[0].context.template.fields, [
    { key: "repo", value: "acme/web" },
    { key: "severity", value: "high" },
  ]);
});

test("an ABSENT overrides object leaves the template's own fields untouched", async () => {
  for (const overrides of [undefined, {}, null, "junk"]) {
    const m = boot();
    await m.launchFromButton(payload({ templateId: TPL, overrides }));
    assert.deepEqual(m.launches[0].context.template.fields, RESOLVED.fields, JSON.stringify(overrides));
  }
});

test("F-281: MAIN enforces the charset the renderer cannot reach, and DROPS the bad row", async () => {
  const m = boot();
  await m.launchFromButton(payload({
    templateId: TPL,
    overrides: {
      fields: [
        { key: "ok", value: "fine" },
        { key: "bad\nkey", value: "x" }, // a newline: forges a line in the ROLE block's voice
        { key: "zw", value: "a​b" }, // zero width
        { key: "sep", value: "a b" }, // line separator
        { key: "", value: "orphan" }, // no key names nothing
        { key: "ok", value: "duplicate" }, // the shape TemplateFieldsSchema refuses
      ],
    },
  }));
  assert.deepEqual(m.launches[0].context.template.fields, [{ key: "ok", value: "fine" }]);
});

test("override key / value bounds are the schema's own numbers, applied here too", async () => {
  const m = boot();
  await m.launchFromButton(payload({
    templateId: TPL,
    overrides: { fields: [{ key: "k".repeat(200), value: "v".repeat(5000) }] },
  }));
  const [f] = m.launches[0].context.template.fields;
  assert.equal(f.key.length, 80);
  assert.equal(f.value.length, 1000);
});

// ⚠ **AND THE SAME NUMBERS APPLY TO WHAT COMES OFF THE WIRE** (F-287). `narrow` used to clip every
// label half at one `MAX_LABEL = 200`, under a comment claiming "names, keys and values are
// SAFE_LABEL_RE-bounded well inside this" — false for `value`, whose schema bound is 1000. A
// boundary bound that UNDERCUTS the writer's is not caution: the operator can neither see it nor
// satisfy it, and the disagreement always resolves against them.
test("the RESOLVED template's bounds are the server's own, field by field (F-287)", async () => {
  const m = boot({
    body: {
      ...RESOLVED,
      name: "N".repeat(400),
      fields: [{ key: "k".repeat(200), value: "v".repeat(5000) }],
    },
  });
  await m.launchFromButton(payload({ templateId: TPL }));
  const t = m.launches[0].context.template;
  assert.equal(t.name.length, 120, "`schema.ts › NameSchema`, not the old 200 and not 80");
  assert.equal(t.fields[0].key.length, 80, "`TemplateFieldSchema.key`");
  assert.equal(t.fields[0].value.length, 1000, "`TemplateFieldSchema.value` — 200 lost 800 of it");
});

test("a 300-character field value survives the boundary intact — it is legal", async () => {
  const value = "x".repeat(300);
  const m = boot({ body: { ...RESOLVED, fields: [{ key: "style_rules", value }] } });
  await m.launchFromButton(payload({ templateId: TPL }));
  assert.equal(m.launches[0].context.template.fields[0].value, value);
});

test("an EMPTY VALUE survives — a key with no value yet is a legitimate half-filled form", async () => {
  const m = boot();
  await m.launchFromButton(payload({ templateId: TPL, overrides: { fields: [{ key: "repo", value: "" }] } }));
  assert.deepEqual(m.launches[0].context.template.fields, [{ key: "repo", value: "" }]);
});

test("the field overrides are applied AFTER the approval gate, never before it", async () => {
  // What the operator approves is the INSTRUCTIONS — the part they did not write — and those are
  // never overridable at launch. Renderer text must not sit in front of that question.
  const m = boot({ body: { ...RESOLVED, authoredByCaller: false } }, { approved: false });
  const res = await m.launchFromButton(payload({
    templateId: TPL, overrides: { fields: [{ key: "repo", value: "evil" }] },
  }));
  assert.equal(res.reason, "template-approval");
  assert.deepEqual(res.template, { name: "Code Auditor", instructions: "Audit the diff." });
});

// ── 6. CONTAINMENT IS UNTOUCHED, AND THE CAPTURE SURVIVES ────────────────────

test("a template supplies NO containment input — profile, posture and lane stay the machine's", async () => {
  const m = boot({
    body: {
      ...RESOLVED,
      // Everything a hostile payload might try to smuggle in.
      toolProfile: "full", profile: "full", startModes: { tools: "bypass" },
      windowless: false, idle: false, cwd: "/etc",
    },
  });
  await m.launchFromButton(payload({ templateId: TPL }));
  const spec = m.launches[0];
  assert.equal(spec.toolProfile, "full", "resolved from main's own channel DTO, not the payload");
  assert.deepEqual(spec.startModes, { tools: "manual", messages: "auto_inbound" });
  assert.equal(spec.windowless, true);
  assert.equal(spec.idle, true, "template agents spawn idle exactly like everything else");
  assert.equal(spec.mode, "interactive");
  assert.equal("cwd" in spec, false);
  // …and none of the smuggled keys survived the narrowing.
  for (const k of ["toolProfile", "profile", "startModes", "windowless", "idle", "cwd"]) {
    assert.equal(k in spec.context.template, false, k);
  }
});

test("a template never replaces the GOAL — ROLE first, GOAL last", async () => {
  const m = boot();
  await m.launchFromButton(payload({ templateId: TPL, threadTitle: "Ship it" }));
  assert.match(m.launches[0].goal, /^Join the thread "Ship it" as my agent:/);
});

test("`context.template` rides the funnel's LITERAL WHITELIST and survives park/resume", () => {
  // ⚠ ASSERTED AS A SOURCE FACT, because the property IS the source: `session-launch.js › launch`
  // forwards `context` by name (anything it does not name is dropped), `session-engine.js ›
  // startSession` merges `spec.context` onto the session object, and `session-park.js ›
  // resumeParked` operates IN PLACE — it rebuilds the abort controller and the iterator and never
  // touches `s.context`. So a parked agent woken an hour later still carries what was resolved at
  // spawn, and that falls out of the architecture rather than being enforced anywhere.
  assert.match(read("session-launch.js"), /^\s*context: a\.context,$/m, "the funnel names it");
  assert.match(
    read("session-engine.js"),
    /const context = \{ \.\.\.\(spec\.context \|\| \{\}\), channelId: spec\.channelId/,
    "startSession merges the spec's context onto the session"
  );
  const park = read("session-park.js");
  const resume = park.slice(park.indexOf("function resumeParked("), park.indexOf("async function startResumedConsumer("));
  assert.equal(/s\.context/.test(resume), false, "a park/resume never rewrites the context");
  // …and the framing reads it from there, with the session's OWN profile spread on at wake.
  assert.match(read("session-seed.js"), /context: \{ \.\.\.\(\(s && s\.context\) \|\| \{\}\), profile: s\.profile \}/);
});

// ⚠ **AND A CRASH RESUME IS THE OTHER HALF, WHICH THE ARCHITECTURE DID *NOT* GIVE FOR FREE**
// (F-288, 2026-08-23). The case above is about `resumeParked`, which works IN PLACE. `startResume`
// is a full re-`startSession` off a DURABLE RECORD, and the durable projection is a literal
// whitelist — so `context.template`, a spawn-time capture living only on the live session object,
// was simply absent after a crash. INVARIANTS §5A asserted the in-place argument for BOTH, which
// is how the gap survived: the doc named the one lane where the claim was true.
//
// ⚠ THREE FILES HAVE TO AGREE OR THE FIELD SILENTLY NEVER ARRIVES — the projection
// (`session-io.js › baseRecord`), the store whitelist (`session-store.js ›
// durableSessionRecord`), and the rehydrate (`session-park.js › contextFromRecord`). Two out of
// three is a value that is written and never read, or read and never written; either way the
// symptom is the same null. `session-park-resume-profile.test.mjs` drives the resume end of it.
test("F-288: the template NAME is projected, whitelisted and rehydrated — all three", () => {
  assert.match(read("session-io.js"),
    /templateName: \(s\.context && s\.context\.template && s\.context\.template\.name\) \|\| null/,
    "baseRecord must project it, or nothing reaches disk");
  assert.match(read("session-store.js"), /templateName: durableName\(r\.templateName, 120\)/,
    "the durable whitelist must name it — at 120, the column's own bound, not the 80 display default");
  assert.match(read("session-park.js"),
    /template: r\.templateName \? \{ name: r\.templateName \} : null/,
    "contextFromRecord must rebuild it, or the resumed session reports a blank template");
  // ⚠ THE NAME ONLY. Persisting another member's prompt text to answer a question nothing asks
  // after spawn would be a real cost for no reader — see `contextFromRecord`'s own note.
  const store = read("session-store.js");
  for (const k of ["templateInstructions", "templateFields", "templateBases"]) {
    assert.equal(store.includes(k), false, `${k} has no reader after spawn and must not be stored`);
  }
});

test("the SOURCE says the resolve happens in MAIN, and no snapshot path exists", () => {
  const op = read("session-launch-op.js");
  assert.match(op, /require\('\.\/template-resolve'\)\.resolveTemplate\(p\.templateId/,
    "main resolves the id itself");
  // ⚠ THE RENDERER MUST NOT BE ABLE TO SUPPLY CONTENT. A `p.instructions` / `p.template` read
  // here would be F-267 repeated with prompt text.
  assert.equal(/p\.instructions|p\.template\b/.test(op), false,
    "no path takes template CONTENT from the payload");
});
