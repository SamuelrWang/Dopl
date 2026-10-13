// main/session-windowless.js — WHERE A NOTICE'S CLICK GOES.
//
// ⚠ SPLIT OUT OF `test/session-windowless-deny.test.mjs` ON 2026-10-12, at the §2 500-line cap,
// when the failed-decision cases landed. Every case below was there before or is new to that
// fix; none was dropped, and the loader both files use is
// `helpers/session-windowless-harness.mjs` so the two suites cannot disagree about what this
// module may reach.
//
// ONE SUBJECT: every notice this module raises offers a way back to the SAME place — this
// session's channel and thread, through `openThread` — and a dead window never escapes into a
// notification callback.
//
// Run: `node --test dopl-desktop-app/test/session-windowless-open.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { load, session, timers, REQ, flush } from "./helpers/session-windowless-harness.mjs";

// ── "DECISION NOT RECORDED" IS CLICKABLE TOO (Samuel, 2026-10-12) ───────────────────────────
//
// 🔒 The in-app pop-up for a decision that did not reach the server must jump to the thread, the
// same way the mention pop-up now does. `consent.js › notifyDecisionFailed` already forwards
// `onClick: opts.onOpen` into the route — it is THIS file that never supplied one, so the handler
// was always undefined, no handle was parked, and the card was dead. The navigation has to come
// from here because this is the layer that knows the thread.

test("the operator's Allow carries a way back: a failed decision's pop-up opens channel + thread", async () => {
  timers.reset();
  const opened = [];
  const outbound = [];
  const decided = [];
  const nav = { openChannelForEntry: (entry, opts) => opened.push({ entry, opts }) };
  const m = load({
    createConsentRequest: async () => ({ rowId: "row-9", status: "pending" }),
    notifyOutbound: (args) => outbound.push(args),
    submitDecision: async (workspaceId, rowId, decision, opts) => {
      decided.push({ workspaceId, rowId, decision, opts });
    },
    pollStatus: async () => "allowed",
  }, nav);
  const s = session({ context: { channelName: "Website", workspaceSegment: "acme" },
    pendingPermissions: new Map([["req-2", {}]]) });
  m.claimGate(s, { type: "outbound_gate", requestId: "req-2", text: "hi" }, () => {});
  await flush(); await flush();
  assert.equal(outbound.length, 1, "the outbound banner exists — otherwise there is no Send to press");

  // Press Send. That is the decision whose PATCH may not land.
  outbound[0].onSend();
  await flush();
  assert.equal(decided.length, 1);
  assert.equal(decided[0].decision, "allow");
  // ⚠ THE WHOLE POINT. Without this the pop-up `consent.js` raises has `onClick: undefined`,
  // parks no handle, and renders a card with nothing to click.
  assert.equal(typeof decided[0].opts.onOpen, "function", "the failed-decision pop-up needs a way back");

  // …and it is the SAME navigation both banners use: this session's channel AND thread.
  decided[0].opts.onOpen();
  assert.deepEqual(opened, [{
    entry: { channel: { id: "chan-1", name: "Website" }, workspaceId: "ws-1", workspaceSegment: "acme" },
    opts: { threadId: "task-1" },
  }]);

  // Navigation is best-effort here as everywhere: a dead window must not escape into the callback.
  nav.openChannelForEntry = () => { throw new Error("window gone"); };
  assert.doesNotThrow(() => decided[0].opts.onOpen());
  timers.reset();
});

test("…and the housekeeping cancel carries NONE, deliberately", async () => {
  // ⚠ THE CONTROL, and a decision rather than an oversight. `watchRow`'s cancel fires when the
  // tool call a row was gating is already gone — the operator never made that decision, so there
  // is nothing for them to "decide again" and no thread state a click would usefully reveal.
  // Without this case the one above would pass against a change that sprayed `onOpen` onto every
  // `submitDecision` call in the file.
  timers.reset();
  const decided = [];
  const m = load({
    createConsentRequest: async () => ({ rowId: "row-9", status: "pending" }),
    notifyOutbound: () => {},
    submitDecision: async (workspaceId, rowId, decision, opts) => {
      decided.push({ decision, opts });
    },
    // Still pending on every poll, so the loop reaches its own settle check rather than a verdict.
    pollStatus: async () => "pending",
  });
  const s = session({ context: { channelName: "Website", workspaceSegment: "acme" },
    pendingPermissions: new Map([["req-2", {}]]) });
  m.claimGate(s, { type: "outbound_gate", requestId: "req-2", text: "hi" }, () => {});
  await flush(); await flush();

  // The gated call goes away, which is exactly what the cancel is for.
  s.pendingPermissions.delete("req-2");
  for (let i = 0; i < 4; i++) { timers.fire(); await flush(); }

  const cancels = decided.filter((d) => d.decision === "deny");
  assert.equal(cancels.length, 1, "the cancel really fired — otherwise this asserts nothing");
  assert.deepEqual(cancels[0].opts, {}, "no way back, because the operator never made this decision");
  timers.reset();
});

// ── THE BANNERS' OPEN ACTION (cleanup d05: one `openThread` behind both banners) ──
// Both the tool-gate banner and the outbound banner open THIS session's thread, and a throwing
// navigation must never escape into the notification callback.
test("both banners' open action opens this session's thread, and navigation failure is swallowed", async () => {
  timers.reset();
  const opened = [];
  const outbound = [];
  const nav = { openChannelForEntry: (entry, opts) => opened.push({ entry, opts }) };
  const m = load({
    createConsentRequest: async () => ({ rowId: "row-9", status: "pending" }),
    notifyOutbound: (args) => outbound.push(args),
    pollStatus: async () => "allowed",
  }, nav);
  const s = session({ context: { channelName: "Website", workspaceSegment: "acme" },
    pendingPermissions: new Map([["req-1", {}], ["req-2", {}]]) });
  m.claimGate(s, REQ, () => {});
  m.claimGate(s, { type: "outbound_gate", requestId: "req-2", text: "hi" }, () => {});
  await flush(); await flush();
  assert.equal(m.banners.length, 1, "the tool banner exists");
  assert.equal(outbound.length, 1, "the outbound banner exists");
  m.banners[0].onOpen();
  outbound[0].onOpen();
  const want = { entry: { channel: { id: "chan-1", name: "Website" }, workspaceId: "ws-1", workspaceSegment: "acme" },
    opts: { threadId: "task-1" } };
  assert.deepEqual(opened, [want, want]);
  nav.openChannelForEntry = () => { throw new Error("window gone"); };
  assert.doesNotThrow(() => m.banners[0].onOpen());
  assert.doesNotThrow(() => outbound[0].onOpen());
  timers.reset();
});
