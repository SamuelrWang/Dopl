// AXIS A's ANSWER SHAPE — how Dopl's verdict becomes THIS platform's reply to a held approval
// request, and how a raw app-server request becomes a name the gate can be asked about.
//
// ⚠ THE RULES ARE DOPL'S; ONLY THE SHAPE IS THE PLATFORM'S. `main/session-profiles.js ›
// grantDecision` decides, in one place, with one order. This file does nothing but write that
// decision in the four words `codex app-server` answers in. A second decision here would be a gate
// in two places, which is the failure F-228 / 1.7.10 bought.
//
// ⚠ FAIL CLOSED ON ANYTHING BUT AN EXPLICIT ALLOW. An unknown verdict, `undefined`, a thrown
// object — all decline.
//
// ⚠ AND WE NEVER ANSWER `acceptForSession`. This is the whole double-count guard, and it is a
// REFUSAL rather than a preference. `codex-research.md` §4 item 2: Codex has a native "yes, and
// stop asking for the rest of this session" answer, and Dopl's op-scoped grants are a superset of
// it. Sending `acceptForSession` would record ONE operator click on TWO ledgers — Dopl's scoped
// grant key AND Codex's own session grant — and the second one is scoped by something we cannot
// read (§5 item C4 asks whether it covers the exact command, the family, or the category). That is
// precisely the fused-checkbox defect class of 1.7.10. So Dopl answers `accept`, every later call
// re-asks Dopl's gate, and a standing grant answers it from Dopl's own ledger with no card. One
// click, one ledger, one scope — the one the operator was shown.

const tools = require('./tools');

// ── THE REQUEST -> NAME MAPPING ──────────────────────────────────────────────────────────────
//
// ⚠ THE ONE PLACE A CODEX APPROVAL REQUEST BECOMES A NAME, so the gate, the deny lists and the
// Axis-A allow-lists are all asked about the SAME three-word vocabulary and cannot drift. The
// words are the app-server's own item names (`codex-research.md` §1) and the `granular` category
// names (§2) — nothing here is translated from another runtime.
//
// ⚠ AN UNRECOGNISED METHOD ANSWERS ITS OWN RAW METHOD STRING, NOT A FALLBACK NAME. A name in no
// Axis-A list gates in every mode, so an approval shape a future CLI adds asks the operator
// instead of resolving to something already classified. Collapsing it onto `commandExecution`
// would be the opposite: a new escalation inheriting an existing mode's grant.
const REQUEST_ITEM_RE = /^item\/([A-Za-z0-9_]+)\/requestApproval$/;

function toolNameFor(request) {
  const req = request || {};
  if (typeof req.toolName === 'string' && req.toolName) return req.toolName; // an MCP tool call
  const method = typeof req.method === 'string' ? req.method : '';
  const m = REQUEST_ITEM_RE.exec(method);
  if (m) return m[1]; // commandExecution | fileChange | whatever a later build adds
  const category = req.params && req.params.category;
  if (typeof category === 'string' && tools.GRANULAR_CATEGORIES.indexOf(category) !== -1) {
    return category;
  }
  return method || 'unknown';
}

// ── THE ANSWER ───────────────────────────────────────────────────────────────────────────────

/**
 * The platform's reply object for one held approval request.
 *
 * `request` — `{ tag, message }`. `tag` is the forced thread tag or null; `message` is the
 * sentence a decline carries, which the OPERATOR sees.
 * `verdict` — Dopl's answer: `'allow'`, or anything else, which declines.
 *
 * ⚠ THE TAG DOES NOT RIDE THIS ANSWER ON THIS RUNTIME, and that is the honest difference from the
 * Claude adapter rather than an omission. Codex's approval reply is one of four WORDS — `accept`,
 * `acceptForSession`, `decline`, `cancel` — with no documented slot for rewritten arguments, so
 * there is nothing here to attach an `updatedInput` to. The stamp travels the only documented
 * input-rewrite lever this runtime has, the `PreToolUse` hook's `updatedInput`, which is
 * `stampOutbound` below and `axis-b.js`'s handler. The tag is accepted and ignored here so the
 * call shape matches the Claude adapter's and a reader can see WHERE it went.
 */
function answerApproval(request, verdict) {
  const req = request || {};
  // ⚠ `accept`, NEVER `acceptForSession`. See the header — this is the double-count refusal, and
  // `test/codex-gate.test.mjs` pins that no verdict, however wide, produces the other word.
  // ⚠ THAT ANCHOR NAMED `test/codex-approval.test.mjs` UNTIL 2026-08-31 AND NO SUCH FILE EXISTS —
  // a reference to a pin is worth what the pin is, and one pointing at nothing reads as a stronger
  // guarantee than the real one. Corrected against the tree, not from memory (CLAUDE.md rule 2).
  if (verdict === 'allow') return { decision: 'accept' };
  return { decision: 'decline', message: req.message || 'Denied by operator' };
}

/**
 * Apply the forced thread tag by this runtime's declared route (`axisB.inputRewrite`).
 *
 * ⚠ THE TAG IS AN INVARIANT, NOT A REQUEST. The delivery prompt already names the thread and the
 * agent omits the argument anyway — measured, with an incident behind it
 * (`main/session-outbound-tag.js`'s header). The value is the session's own task id, which comes
 * from the spawn spec ON THIS MACHINE and never off the wire.
 *
 * ⚠ ON THIS RUNTIME THE ROUTE IS THE `PreToolUse` HOOK, AND THE RETURN CARRIES NO `decision`
 * FIELD. That is the design's §0.1 ruling, restated as code: ONE PLACE DECIDES (the app-server
 * approval callback, feeding `grantDecision`), ONE PLACE STAMPS (this). A hook that also rendered
 * a verdict would be a gate in two places, which is the F-228 / 1.7.10 lesson; a hook that could
 * not rewrite at all would mean `axisB.inputRewrite` is `null` here and agents stop self-filtering
 * their own posts in a shared channel. Whether a decision-less return passes through is §5 item
 * C6, and whether a Dopl-installed hook can run un-trusted at all is C17.
 *
 * `input` — the tool input the hook was handed (`tool_input` on the hook's stdin JSON).
 * `tag`   — `session-outbound-tag.js › threadTagFor`'s answer.
 * ⚠ `null` IS NOT A LEGAL RETURN: an un-stamped post is a fan-out/echo failure, not a cosmetic
 * one, so a tag that does not apply answers the input UNCHANGED rather than nothing.
 */
function stampOutbound(input, tag) {
  const base = input && typeof input === 'object' ? input : {};
  if (!tag || tag.action !== 'inject') return { updatedInput: base };
  // ⚠ NO `decision` KEY, EVER. Not `'allow'`, not `undefined` — absent.
  return { updatedInput: tag.input };
}

// Descriptor half — AXIS A ONLY. Axis B's enforcement point is `axis-b.js`'s.
const descriptor = {
  // ⚠ TRUE: `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` are
  // server->client JSON-RPC REQUESTS — the server blocks the turn on our reply and then emits
  // `serverRequest/resolved`. That is a held pre-execution callback, which is what makes `gate` a
  // real verdict rather than a pre-flight list, and it is why `codex app-server` is the adapter
  // target instead of the SDK or `codex exec` (both fix policy at launch, `codex-research.md` §1).
  heldCallback: true,
  // ⚠ `category`, NOT `per-tool`, AND THE UI SAYS SO. Codex gates a shell command, a file change,
  // a sandbox escalation — not a named built-in. There is no "approve Read but not Grep" here and
  // Dopl does not synthesise one (design decision 1; `codex-research.md` §4 item 1 reaches the
  // same conclusion and recommends the honest UI first). MCP tools are the exception and are
  // genuinely per-tool, which is `mcp.perToolApproval`.
  granularity: 'category',
  // ⚠ CODEX'S OWN `granular` CATEGORY NAMES, VERBATIM. Rendered as a five-row sub-control under
  // the `granular` mode only. Revision 1 of the design invented `['command','file-change',
  // 'network','mcp']` here; those words appear nowhere in the research and inventing category
  // names inside the descriptor whose purpose is to enforce native vocabulary is the exact failure
  // decision (1) exists to prevent.
  categories: tools.GRANULAR_CATEGORIES.slice(),
  // ⚠ TRUE AS A CAPABILITY CLAIM, AND DELIBERATELY NOT ACTUATED IN v1. Codex HAS a native
  // `acceptForSession`; that is a fact about the platform and the descriptor's job is to state it.
  // `answerApproval` above never sends it, because its scope is §5 item C4 and an unscoped second
  // ledger is the 1.7.10 defect. So: the capability is declared, the affordance is not built until
  // C4 comes back, and the two statements do not contradict each other — one is about Codex, the
  // other is about what Dopl does with it.
  sessionGrant: true,
  // ⚠ `'unverified'` — a legal value, and a DIFFERENT answer from absent. `codex-research.md` §2
  // documents permission profiles as hot-swappable "via the `/permissions` slash command without
  // restarting the session", and `/permissions` is a TUI command; nothing in the research shows it
  // reachable over app-server JSON-RPC. So the UI offers no live swap and a mode change takes
  // effect on the next launch (§5 item C7). Dopl's OWN gate reads both axes live at decision time
  // either way, so a posture change is never stale where it matters.
  hotSwapModes: 'unverified',
};

module.exports = { answerApproval, stampOutbound, toolNameFor, descriptor };
