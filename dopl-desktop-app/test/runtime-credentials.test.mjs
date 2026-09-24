// Dopl's own runtime credentials (`main/runtime-credentials.js`): each in-app-sign-in runtime's status and
// its push, the one sign-in prompt per runtime, the `runtime:signIn` op and the sign-out. The REAL registry's
// descriptors decide which runtimes are listed; their credential and sign-in behaviour is faked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWithStubs, real } from "./helpers/module-sandbox.mjs";
import { bootIpc } from "./_ipc-harness.mjs";

const registry = real("./runtime");
const settle = () => new Promise((r) => setImmediate(r));

function world({ signedIn = [], focused = false, signIns = {}, signOuts = {} } = {}) {
  const sent = [];
  const notes = [];
  const shown = [];
  const resumed = [];
  const ran = [];
  const cred = new Set(signedIn);
  const runtimeFor = (id) => ({
    credentialState: async () => ({ usable: cred.has(id), source: cred.has(id) ? "dopl" : null }),
    signIn: async () => {
      ran.push(id);
      const answer = typeof signIns[id] === "function" ? await signIns[id]() : signIns[id];
      if (answer instanceof Error) throw answer;
      if (answer && answer.ok) cred.add(id);
      return answer;
    },
    signOut: async () => {
      if (signOuts[id] instanceof Error) throw signOuts[id];
      cred.delete(id);
      return id in signOuts ? signOuts[id] : true;
    },
  });
  class Notification {
    constructor(opts) { this.opts = opts; }
    static isSupported() { return true; }
    on(_event, fn) { this.click = fn; }
    show() { notes.push(this); }
  }
  const mod = loadWithStubs("runtime-credentials.js", {
    "./runtime": { ...registry, runtimeFor },
    "./diag": { diag: () => {} },
    electron: { BrowserWindow: { getFocusedWindow: () => (focused ? {} : null) }, Notification },
    "./session-auth": { resumeHeldSessions: async (id) => { resumed.push(id); return 2; } },
  });
  const win = { webContents: { send: (channel, payload) => sent.push({ channel, payload }) } };
  mod.start({ getWindows: () => [win], showWindow: () => shown.push(true) });
  const rows = () => sent[sent.length - 1].payload.runtimes;
  const row = (id) => rows().find((r) => r.runtimeId === id);
  return { mod, sent, notes, shown, resumed, ran, cred, rows, row };
}

// ── STATUS AND ITS PUSH ──────────────────────────────────────────────────────────────────────

test("only the runtimes Dopl signs in from the app are listed, by their own label, pushed on start", async () => {
  const w = world({ signedIn: ["codex"] });
  await settle();
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].channel, w.mod.STATUS_EVENT);
  assert.equal(w.mod.STATUS_EVENT, "dopl:runtime-credentials");
  assert.deepEqual(w.rows(), [
    { runtimeId: "claude", label: "Claude Code", state: "not-connected", prompt: false },
    { runtimeId: "codex", label: "Codex", state: "connected", prompt: false },
  ], "Cursor declares no in-app sign-in, so it has no row");
  assert.deepEqual(await w.mod.list(), w.rows(), "the read and the push are one answer");
});

test("signing-in while the flow runs, connected after it; each change is pushed once and no more", async () => {
  let finish = () => {};
  const w = world({ signIns: { claude: () => new Promise((r) => { finish = r; }) } });
  await settle();
  const pending = w.mod.signIn("claude");
  await settle();
  assert.equal(w.row("claude").state, "signing-in");
  const before = w.sent.length;
  w.mod.dismissPrompt("claude"); // nothing to dismiss: no change, no push
  await settle();
  assert.equal(w.sent.length, before);
  finish({ ok: true });
  assert.deepEqual(await pending, { ok: true, resumed: 2 });
  await settle();
  assert.equal(w.row("claude").state, "connected");
  assert.equal(w.sent.length, before + 1, "one push for the change, none for the unchanged re-read");
});

test("a rejected Dopl credential reads `expired` until a sign-in replaces it; a missing one never does", async () => {
  const w = world({ signedIn: ["claude"], signIns: { claude: { ok: true } } });
  w.mod.noteRejected("claude");
  w.mod.noteRejected("codex");
  await settle();
  assert.deepEqual([w.row("claude").state, w.row("codex").state], ["expired", "not-connected"]);
  await w.mod.signIn("claude");
  await settle();
  assert.equal(w.row("claude").state, "connected");
});

// ── THE PROMPT ───────────────────────────────────────────────────────────────────────────────

test("the prompt is raised ONCE per runtime — N held agents, one prompt, one notification", async () => {
  const w = world();
  for (let i = 0; i < 3; i += 1) w.mod.needSignIn("codex");
  w.mod.needSignIn("cursor"); // no in-app flow: nothing to prompt
  await settle();
  assert.deepEqual([w.row("codex").prompt, w.row("claude").prompt], [true, false]);
  assert.equal(w.notes.length, 1);
  assert.equal(w.notes[0].opts.title, "Sign in to Codex");
  w.notes[0].click();
  assert.deepEqual(w.shown, [true], "the notification's click reveals the app, where the prompt is");
});

test("no notification while Dopl is in front — the prompt itself is enough", async () => {
  const w = world({ focused: true });
  w.mod.needSignIn("claude");
  await settle();
  assert.equal(w.row("claude").prompt, true);
  assert.equal(w.notes.length, 0);
});

test("a dismissed prompt stays closed until a sign-in resolves it; after that it can be raised again", async () => {
  const w = world({ signIns: { codex: { ok: true } } });
  w.mod.needSignIn("codex");
  assert.equal(w.mod.dismissPrompt("codex"), true);
  assert.equal(w.mod.dismissPrompt("codex"), false, "nothing left to dismiss");
  w.mod.needSignIn("codex");
  await settle();
  assert.equal(w.row("codex").prompt, false, "dismissed: a later held agent does not re-raise it");
  assert.equal(w.notes.length, 1);
  await w.mod.signIn("codex");
  await w.mod.signOutAll();
  w.mod.needSignIn("codex");
  await settle();
  assert.equal(w.row("codex").prompt, true, "resolved, so the next need raises it again");
});

test("a sign-in that takes resolves the open prompt; one that fails leaves it standing", async () => {
  const w = world({ signIns: { claude: { ok: false }, codex: { ok: true } } });
  w.mod.needSignIn("claude");
  w.mod.needSignIn("codex");
  await w.mod.signIn("claude");
  await w.mod.signIn("codex");
  await settle();
  assert.deepEqual([w.row("claude").prompt, w.row("codex").prompt], [true, false]);
});

// ── THE OP ───────────────────────────────────────────────────────────────────────────────────

test("the op runs the NAMED runtime's sign-in and releases ONLY that runtime's held agents", async () => {
  const w = world({ signIns: { codex: { ok: true }, claude: { ok: true } } });
  assert.deepEqual(await w.mod.signIn("codex"), { ok: true, resumed: 2 });
  assert.deepEqual(await w.mod.signIn(""), { ok: true, resumed: 2 }, "'' is the default runtime");
  assert.deepEqual(w.ran, ["codex", "claude"]);
  assert.deepEqual(w.resumed, ["codex", "claude"]);
});

test("an unregistered runtime or one with no in-app flow refuses without running anything", async () => {
  const w = world();
  assert.deepEqual(await w.mod.signIn("nope"), { ok: false });
  assert.deepEqual(await w.mod.signIn("cursor"), { ok: false });
  assert.deepEqual(w.ran, []);
});

test("a failed or throwing sign-in is the bare refusal and releases nothing", async () => {
  const w = world({ signIns: { codex: { ok: false, reason: "cancelled" }, claude: new Error("boom") } });
  assert.deepEqual(await w.mod.signIn("codex"), { ok: false }, "no reason crosses");
  assert.deepEqual(await w.mod.signIn("claude"), { ok: false });
  await settle();
  assert.deepEqual(w.resumed, []);
  assert.deepEqual([w.row("claude").state, w.row("codex").state], ["not-connected", "not-connected"]);
});

test("the boundary refuses a malformed id before any credential module loads", async () => {
  const ipc = bootIpc();
  for (const runtimeId of ["../codex", "Codex", 42, { id: "codex" }, "x".repeat(40)]) {
    assert.deepEqual(await ipc.handlers["runtime:signIn"](ipc.shell, { runtimeId }), { ok: false }, String(runtimeId));
    assert.deepEqual(await ipc.handlers["runtime:dismissSignInPrompt"](ipc.shell, { runtimeId }), { ok: false }, String(runtimeId));
  }
  assert.deepEqual(ipc.dialogs, []);
});

// ── SIGN-OUT ─────────────────────────────────────────────────────────────────────────────────

test("a Dopl sign-out drops every runtime's own credential, clears the prompts, and says if one stayed", async () => {
  const w = world({ signedIn: ["claude", "codex"] });
  w.mod.noteRejected("claude");
  assert.equal(await w.mod.signOutAll(), true);
  await settle();
  assert.deepEqual(w.rows().map((r) => [r.runtimeId, r.state, r.prompt]),
    [["claude", "not-connected", false], ["codex", "not-connected", false]]);
  assert.equal(await world({ signOuts: { codex: false } }).mod.signOutAll(), false);
  assert.equal(await world({ signOuts: { claude: new Error("EACCES") } }).mod.signOutAll(), false);
});
