// Dopl session window — the COMPOSER ADDRESSEE PILL, pure layer.
//
// ONE composer, TWO addressees, chosen on a CONTROL. The default steers the window you are
// looking at; the other row posts the operator's OWN words into the channel addressed to the
// peer (their inbound gate, their agent, their reply).
//
// ⚠ A CONTROL, deliberately NOT an `@tag`: a tag is only reachable by someone who already knows
// it exists, and the option you cannot discover here is the one that LEAVES THIS MACHINE. So no
// tokenizer, no popup-over-the-caret state machine, no matcher, no "an unrecognized tag is not
// a tag" rule, and no keydown contention with Enter. A picked target is a variable, the draft
// is plain text end to end, and the delivered bytes are exactly what was typed.
//
// ⚠ SECURITY — why a peer-addressed send carries NO approval card: every gate on this surface
// bounds an AGENT-authored action. A peer-addressed send is the opposite shape — human-typed,
// human-picked, into a channel the human is already a member of — so a card would ask the
// operator to approve themselves to themselves (identical posture to the web composer). Nothing
// on this path touches grantDecision / allowForTask / the two permission axes, it never becomes
// a steer (no session:send, no pushTurn, no canUseTool), and the PEER's side gates it like any
// other inbound message.
//
// ⚠ DOM / electron / fs free and UMD-wrapped like session-chrome.js. Returns STRINGS and PLAIN
// OBJECTS only, never markup; session-address-ui.js prints every string via textContent.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionAddress = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Shared string discipline (one line + cap) lives in session-format.js. ⚠ The counterparty's
  // display name is the ONLY untrusted input here and `oneLine` is what bounds it, so a missing
  // formatter is a HARD LOAD ERROR — a silent fallback would let an unbounded name through.
  const fmt =
    typeof module === "object" && typeof require === "function"
      ? require("./session-format.js")
      : (typeof globalThis !== "undefined" && globalThis.DoplSessionFormat) || null;
  if (!fmt || typeof fmt.oneLine !== "function") {
    throw new Error("session-address: session-format.oneLine is required");
  }

  // ─── BEGIN SESSION-ADDRESS-PURE (pure; unit-tested via source extraction) ────

  // ── copy (NO em dashes; every string reaches the DOM via textContent) ────────
  const MENU_LABEL = "Send to";
  // The handle is minted in MAIN (session-summary's ledger) and read over IPC. ⚠ Until it
  // arrives (and on a desktop whose IPC has no such handler) the fallback names the WINDOW, not
  // a placeholder handle: "this session" is true in every case.
  const SELF_FALLBACK = "this session";
  const SELF_HINT = "Steers the agent in this window.";
  // ⚠ The peer row's hint states the two things the operator cannot see: my agent is not
  // involved, theirs is. Both load-bearing — this is the row that leaves the machine.
  const PEER_HINT = "Posts your own words to the channel. Their agent picks it up, yours does not see it.";
  const PEER_FALLBACK = "the peer";
  const SOLO_NOTE = "This session has no counterparty, so only your own agent can be reached from here.";
  const STATUS_SENDING = "Sending";
  const STATUS_SENT = "Sent";
  const STATUS_FAILED = "Not sent";

  const TARGET_SELF = "self";
  const TARGET_PEER = "peer";
  /** ⚠ THE RESTING TARGET IS THE WINDOW YOU ARE LOOKING AT: steering costs nothing and stays
   *  on this machine, while the other row wakes somebody else, so it is opt-in. */
  const DEFAULT_TARGET = TARGET_SELF;

  const NAME_CAP = 80; // the bound chrome.identityName / prompt-framing.sanitizeName use
  // ⚠ Tighter than NAME_CAP: the who-line is one short uppercase row above the body, and an
  // unbounded name there pushes the body and the Sent status clean off screen.
  const WHO_NAME_CAP = 60;

  /** A display name, one-lined and bounded, or "" — the ONE place either name is sanitized. */
  function safeName(value, cap) {
    return fmt.oneLine(value == null ? "" : value, cap || NAME_CAP);
  }

  function selfLabel(sessionName) {
    return "Message " + (safeName(sessionName) || SELF_FALLBACK);
  }
  function peerLabel(peerName) {
    return "Message " + (safeName(peerName) || PEER_FALLBACK);
  }
  /** The who-line of MY peer_message bubble. */
  function peerMessageWho(name) {
    const who = safeName(name, WHO_NAME_CAP);
    return who ? "You to " + who + "'s agent" : "You to their agent";
  }
  function statusText(status) {
    return status === "sent" ? STATUS_SENT : status === "failed" ? STATUS_FAILED : STATUS_SENDING;
  }

  /**
   * The menu's rows, in order. NO peer name => the self row ALONE, which is what makes
   * `resolveTarget` structurally unable to answer 'peer' on a session with no counterparty.
   *
   * THE ADDRESSABLE SET IS {my agent} ∪ {the bound counterparty}, whatever the channel's size,
   * and it is a property of the IPC rather than of this list: a peer post routes to
   * main/session-peer-post.send, which addresses it with the session's BOUND counterparty id
   * (`postBody`: `body.toUserId = s.counterpartyId`), and the renderer sends no addressee at all
   * (`sendToPeer(text)` carries text and nothing else). A session with no counterparty (a group
   * channel opened from a thread card) can address nobody else, and `note()` says so out loud
   * rather than leaving a single-row menu looking broken. Adding roster rows without widening
   * that IPC would deliver every pick to the bound counterparty, which is a worse lie.
   */
  function targetOptions(spec) {
    const s = spec || {};
    const rows = [{ key: TARGET_SELF, label: selfLabel(s.sessionName), hint: SELF_HINT }];
    const peer = safeName(s.peerName);
    if (peer) rows.push({ key: TARGET_PEER, label: peerLabel(peer), hint: PEER_HINT });
    return rows;
  }

  /** The limit line under a menu that can only offer the self row, or "". */
  function note(options) {
    const list = Array.isArray(options) ? options : [];
    return list.some((o) => o && o.key === TARGET_PEER) ? "" : SOLO_NOTE;
  }

  /**
   * THE ONE ADDRESS DECISION A SEND MAKES, and it is deliberately not a passthrough.
   *
   * A held 'peer' must collapse to 'self' the moment the peer row is not on offer. The peer name
   * arrives with `init`, so a window can be picked-on and then re-inited (a park's recreate, an
   * auth hold's synthesized init) into a session with no counterparty; a stale 'peer' would then
   * route a draft to `sendToPeer`, which posts with NO addressee at all. Falling back to the
   * steer is the safe direction: the words stay on this machine.
   */
  function resolveTarget(target, options) {
    const list = Array.isArray(options) ? options : [];
    return list.some((o) => o && o.key === target) ? target : DEFAULT_TARGET;
  }

  /** The picked row's label, for the pill's face. Never a raw key. */
  function labelFor(target, options) {
    const list = Array.isArray(options) ? options : [];
    const hit = list.find((o) => o && o.key === resolveTarget(target, list));
    return hit ? hit.label : selfLabel("");
  }

  // ── the two stream reducer cases, composed OVER vm.reduceEvent in session.js ──
  // ⚠ A peer post renders in MY stream as its OWN kind — never a 'turn' (not a steer; my agent
  // never saw it) and never an 'outbound' (my agent did not draft it, and there is no
  // permission to answer).
  function reducePeerMessage(state, event) {
    const st = state;
    const ev = event;
    if (!st || !ev || typeof ev !== "object" || !ev.localId) return st;
    if (ev.type === "operator_post") {
      const item = {
        kind: "peer_message",
        localId: String(ev.localId),
        // The counterparty display name arrives RAW off main (io.displayNameFor ->
        // profiles.display_name, which the profile route accepts with no length or whitespace
        // validation) and the who-line concatenates it into a `.who` row with no ellipsis of
        // its own. safeName is what bounds it (v2.8 FIX F1).
        to: ev.to == null ? null : safeName(ev.to, WHO_NAME_CAP),
        text: ev.text == null ? "" : String(ev.text),
        status: "sending",
        avatarKey: "self",
      };
      return { ...st, items: (st.items || []).concat([item]) };
    }
    if (ev.type !== "operator_post_result") return st;
    // FAIL CLOSED: only an explicit ok===true paints "Sent". A missing / garbled / false verdict
    // paints "Not sent", so a post that never left never claims it did.
    const status = ev.ok === true ? "sent" : "failed";
    let hit = false;
    const items = (st.items || []).map((it) => {
      if (hit || !it || it.kind !== "peer_message") return it;
      if (it.localId !== String(ev.localId) || it.status !== "sending") return it;
      hit = true;
      return { ...it, status };
    });
    return hit ? { ...st, items } : st;
  }

  // ─── END SESSION-ADDRESS-PURE ────────────────────────────────────────────────

  return {
    MENU_LABEL, SELF_FALLBACK, SELF_HINT, PEER_HINT, PEER_FALLBACK, SOLO_NOTE,
    STATUS_SENDING, STATUS_SENT, STATUS_FAILED,
    TARGET_SELF, TARGET_PEER, DEFAULT_TARGET,
    selfLabel, peerLabel, peerMessageWho, statusText,
    targetOptions, note, resolveTarget, labelFor, reducePeerMessage,
  };
});
