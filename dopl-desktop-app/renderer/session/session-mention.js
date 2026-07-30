// Dopl session window — composer @-ADDRESSING, the pure layer (v2.8).
//
// ONE composer, TWO addressees. Typing `@` as the FIRST non-whitespace character opens a
// 1-2 row popup: picking my agent is today's steer, picking the peer's agent posts the
// operator's OWN words into the channel addressed to the peer (their inbound gate, their
// agent, their reply). A tag anywhere else in the text is inert.
//
// SECURITY (why a peer-addressed send carries no approval card): every gate on this surface
// bounds an AGENT-authored action — the outbound decision card exists because the agent
// drafted a message and the operator must authorize it leaving this machine. A peer-tagged
// send is the opposite shape: human-typed, human-addressed, into a channel the human is
// already a member of, so a card would ask the operator to approve themselves to
// themselves. It is the identical posture to the web composer. Nothing on this path touches
// grantDecision / allowForTask / autoApprove, it never becomes a steer (no session:send, no
// pushTurn, no canUseTool), and the PEER's side gates it like any other inbound message.
//
// DOM / electron / fs free and UMD-wrapped like session-chrome.js: a plain <script> in the
// sandboxed renderer (attaching globalThis.DoplSessionMention), a require() under
// node --test. It returns STRINGS, NUMBERS and PLAIN OBJECTS only, never markup;
// session-mention-ui.js prints every string it produces via textContent.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionMention = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // The shared string discipline (collapse to one line + cap) lives in session-format.js,
  // reached the same way session-chrome.js reaches the view-model: a require() under node,
  // the renderer global in the sandbox (session.html loads session-format.js first). A
  // counterparty-controlled display name is the ONLY untrusted input this module reads, and
  // oneLine is what bounds it, so a missing formatter is a hard load error rather than a
  // silent fallback that would let an unbounded name through.
  const fmt =
    typeof module === "object" && typeof require === "function"
      ? require("./session-format.js")
      : (typeof globalThis !== "undefined" && globalThis.DoplSessionFormat) || null;
  if (!fmt || typeof fmt.oneLine !== "function") {
    throw new Error("session-mention: session-format.oneLine is required");
  }

  // ─── BEGIN SESSION-MENTION-PURE (pure; unit-tested via source extraction) ────

  // ── copy (NO em dashes; every string reaches the DOM via textContent) ────────
  const POPUP_LABEL = "Tag an agent";
  const SELF_HINT = "Your agent";
  const PEER_HINT_UNKNOWN = "Their agent";
  const PEER_MSG_WHO_UNKNOWN = "You to their agent";
  const STATUS_SENDING = "Sending";
  const STATUS_SENT = "Sent";
  const STATUS_FAILED = "Not sent";

  function peerHint(name) {
    return name ? name + "'s agent" : PEER_HINT_UNKNOWN;
  }
  // The who-line of MY peer_message bubble. Possessive on an untrusted name is accepted
  // for v1 (the name is one-lined + capped by reducePeerMessage below, and printed via
  // textContent).
  function peerMessageWho(name) {
    return name ? "You to " + name + "'s agent" : PEER_MSG_WHO_UNKNOWN;
  }
  function statusText(status) {
    return status === "sent" ? STATUS_SENT : status === "failed" ? STATUS_FAILED : STATUS_SENDING;
  }

  // ── tag vocabulary ──────────────────────────────────────────────────────────
  // self is FIXED (`@my-agent`). The peer's slug is DERIVED from the display name, with
  // `@their-agent` as a permanent alias so there is always a tag that works even when the
  // derivation degenerates (a punctuation-only name, or one that would collide with self).
  const SELF_SLUG = "my-agent";
  const PEER_ALIAS = "their-agent";
  const NAME_CAP = 80; // the same bound chrome.identityName / prompt-framing.sanitizeName use
  const SLUG_CAP = 16;
  // FIX F1: the cap the STREAM applies to the counterparty name it prints in a who-line.
  // Tighter than NAME_CAP because the who-line is one short uppercase row above the message.
  const WHO_NAME_CAP = 60;

  // oneLine(name, 80) -> first whitespace token -> lowercase -> strip non [a-z0-9] ->
  // cap 16 -> + "-agent"; a result that would shadow `@my-agent` degrades to the alias.
  function peerSlug(peerName) {
    const first = fmt.oneLine(peerName, NAME_CAP).split(" ")[0];
    const base = first.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, SLUG_CAP);
    if (!base) return PEER_ALIAS;
    const slug = base + "-agent";
    return slug === SELF_SLUG ? PEER_ALIAS : slug;
  }

  // The popup rows, in order. NO peer => the self row only, which is also what makes
  // parseAddress structurally unable to return 'peer' on a session with no counterparty.
  //
  // FIX F6: every row carries its `aliases`, so a tag that WORKS is also a tag that can be
  // FOUND. `@their-agent` is a permanent, stated address (tagTable accepts it), but it
  // was never a row and typing "th" matched nothing at all — which CLOSES the popup, the one
  // thing that looks like "there is no such agent". matchOptions reads the aliases now.
  //
  // DO NOT FIX F13 (verified, not a defect): a peer named "My-Agent" slugs to
  // `@myagent-agent`, so it never shadows `@my-agent` (peerSlug's collision guard) and it
  // merely SORTS next to the self row when the query is "my". There is no hijack: the self
  // row is always index 0 and reducePopup resets the highlight to 0 on every changed query,
  // so Enter on "@my" still accepts my own agent.
  function tagOptions(spec) {
    const name = fmt.oneLine((spec && spec.peerName) || "", NAME_CAP);
    const options = [{ slug: SELF_SLUG, kind: "self", label: SELF_HINT, name: "", aliases: [] }];
    if (name) {
      const slug = peerSlug(name);
      // DO NOT FIX F7 (verified, not a defect): a name with no slug base (a non-Latin or
      // punctuation-only display name) degrades to the alias, and then the ROW ITSELF reads
      // `@their-agent` — the address is on screen, so it was never undiscoverable. The
      // alias list is empty in that case only because it would duplicate the slug.
      const aliases = slug === PEER_ALIAS ? [] : [PEER_ALIAS];
      options.push({ slug, kind: "peer", label: peerHint(name), name, aliases });
    }
    return options;
  }

  // slug (lowercased) -> 'self' | 'peer'. The alias is added only alongside a real peer.
  function tagTable(options) {
    const table = {};
    for (const opt of options || []) {
      if (!opt || !opt.slug) continue;
      const kind = opt.kind === "peer" ? "peer" : "self";
      table[String(opt.slug).toLowerCase()] = kind;
      if (kind === "peer") table[PEER_ALIAS] = "peer";
    }
    return table;
  }

  // ── the leading token (L1: tags are leading-only) ────────────────────────────
  // The ONE tokenizer behind activeMention / parseAddress / hasPeerTag, so the popup can
  // never disagree with what a send actually delivers. A token contaminated by a
  // non-whitespace, non-token character ("@foo.bar", "@my-agent,") is NOT a tag at all.
  const TOKEN_RUN = /^[A-Za-z0-9-]*/;
  function leadingToken(value) {
    const v = value == null ? "" : String(value);
    // FIX F5: `\s`, not just [ \t]. A draft that STARTS with a newline ("\n@their-agent hi")
    // still addressed the peer on send (session.js trims first), but the popup read the
    // untrimmed value and never opened — a peer post with zero autocomplete affordance,
    // the exact disagreement between the popup and the send this tokenizer exists to prevent.
    const lead = /^\s*/.exec(v)[0].length;
    if (v.charAt(lead) !== "@") return null;
    const query = TOKEN_RUN.exec(v.slice(lead + 1))[0];
    const end = lead + 1 + query.length;
    const next = v.charAt(end);
    if (next && !/\s/.test(next)) return null;
    return { start: lead, end, query, rest: v.slice(end) };
  }

  // The tag the caret is currently INSIDE, or null. `caret` non-numeric (or absent) reads
  // as the end of the value, which is where a keystroke leaves it.
  function activeMention(value, caret) {
    const v = value == null ? "" : String(value);
    const tok = leadingToken(v);
    if (!tok) return null;
    const n = Number(caret);
    const pos = Number.isFinite(n) ? Math.max(0, Math.min(v.length, n)) : v.length;
    if (pos <= tok.start || pos > tok.end) return null; // the caret has left the token
    return { start: tok.start, end: tok.end, query: tok.query };
  }

  // Case-insensitive PREFIX match on the slug, on the hint label, or on any ALIAS (F6), so
  // "@d" finds David's agent, "@my" finds mine, and "@th" finds the peer via `@their-agent`.
  function matchOptions(options, query) {
    const q = (query == null ? "" : String(query)).toLowerCase();
    const hit = (s) => String(s == null ? "" : s).toLowerCase().startsWith(q);
    return (options || []).filter((opt) => {
      if (!opt) return false;
      return hit(opt.slug) || hit(opt.label) || (Array.isArray(opt.aliases) && opt.aliases.some((a) => hit(a)));
    });
  }

  // Replace the typed token with "@slug " and report where the caret lands. One following
  // space is absorbed so accepting mid-sentence cannot leave a double space behind.
  function applyMention(value, mention, option) {
    const v = value == null ? "" : String(value);
    if (!mention || !option) return { value: v, caret: v.length };
    const insert = "@" + option.slug + " ";
    const tail = v.slice(mention.end).replace(/^[ \t]/, "");
    return { value: v.slice(0, mention.start) + insert + tail, caret: mention.start + insert.length };
  }

  // ── the ONE address decision a send makes ────────────────────────────────────
  // L2 the tag is STRIPPED from the delivered text ("@my-agent do X" delivers "do X",
  // byte-identical to typing "do X"); L3 a tag with nothing after it delivers nothing;
  // L4 an UNRECOGNIZED tag is not a tag, so the whole raw string (including the "@")
  // goes to my agent rather than silently vanishing.
  function parseAddress(text, options) {
    const raw = text == null ? "" : String(text);
    const tok = leadingToken(raw);
    const to = tok ? tagTable(options)[tok.query.toLowerCase()] : null;
    if (!tok || !to) return { to: "self", text: raw.trim() };
    return { to, text: tok.rest.trim() };
  }

  // Does the CURRENT draft address the peer? Drives the send/pause morph override and the
  // click routing, so it reads the raw textarea value (trimmed here, offsets unused).
  function hasPeerTag(value, options) {
    const tok = leadingToken(String(value == null ? "" : value).trim());
    if (!tok) return false;
    return tagTable(options)[tok.query.toLowerCase()] === "peer";
  }

  // ── the popup state machine ──────────────────────────────────────────────────
  function initialPopup() {
    return { open: false, query: "", start: 0, end: 0, matches: [], index: 0 };
  }

  // 'sync' {value, caret, options} recomputes from the field; 'move' {delta} walks the rows
  // (wrapping); 'close' shuts it. An empty match set CLOSES rather than showing an empty
  // shell, and a changed query resets the highlight to the first row.
  function reducePopup(state, event) {
    const st = state || initialPopup();
    const ev = event || {};
    if (ev.type === "close") return st.open ? initialPopup() : st;
    if (ev.type === "move") {
      const n = st.matches.length;
      if (!st.open || !n) return st;
      const step = Number(ev.delta) || 0;
      return { ...st, index: (((st.index + step) % n) + n) % n };
    }
    if (ev.type !== "sync") return st;
    const m = activeMention(ev.value, ev.caret);
    if (!m) return st.open ? initialPopup() : st;
    const matches = matchOptions(ev.options, m.query);
    if (!matches.length) return st.open ? initialPopup() : st;
    const keep = st.open && st.query === m.query;
    return {
      open: true, query: m.query, start: m.start, end: m.end, matches,
      index: keep ? Math.min(st.index, matches.length - 1) : 0,
    };
  }

  // ── the two stream reducer cases, composed OVER vm.reduceEvent in session.js ──
  // They live here (not in the view-model) because session-viewmodel.js is at its hard
  // 500-line cap. A peer post renders in MY stream as its OWN kind — never a 'turn' (it is
  // not a steer and my agent never saw it) and never an 'outbound' (my agent did not draft
  // it, and there is no permission to answer).
  function reducePeerMessage(state, event) {
    const st = state;
    const ev = event;
    if (!st || !ev || typeof ev !== "object" || !ev.localId) return st;
    if (ev.type === "operator_post") {
      const item = {
        kind: "peer_message", localId: String(ev.localId),
        // FIX F1: the counterparty display name arrives RAW off main (io.displayNameFor ->
        // profiles.display_name, which the profile route accepts with no length or whitespace
        // validation), and the who-line concatenates it into a `.bubble .who` row that has no
        // nowrap / ellipsis of its own. A 16KB multi-line name pushed the message body and the
        // Sending / Sent status clean off screen. oneLine is what the comment above always
        // claimed, and what the popup path already did: make it true here too.
        to: ev.to == null ? null : fmt.oneLine(ev.to, WHO_NAME_CAP),
        text: ev.text == null ? "" : String(ev.text),
        status: "sending", avatarKey: "self",
      };
      return { ...st, items: (st.items || []).concat([item]) };
    }
    if (ev.type !== "operator_post_result") return st;
    // FAIL CLOSED: only an explicit ok===true paints "Sent". A missing / garbled / false
    // verdict paints "Not sent", so a post that never left never claims it did.
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

  // ─── END SESSION-MENTION-PURE ────────────────────────────────────────────────

  return {
    POPUP_LABEL, SELF_HINT, PEER_HINT_UNKNOWN, PEER_MSG_WHO_UNKNOWN,
    STATUS_SENDING, STATUS_SENT, STATUS_FAILED,
    SELF_SLUG, PEER_ALIAS,
    peerHint, peerMessageWho, statusText, peerSlug,
    tagOptions, tagTable,
    activeMention, matchOptions, applyMention,
    parseAddress, hasPeerTag,
    initialPopup, reducePopup, reducePeerMessage,
  };
});
