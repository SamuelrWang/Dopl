'use strict';

// agent-handles.js — THE NAME HALF OF THE @-MENTION CONVENTION, ON MAIN'S SIDE
// (2026-08-28, Samuel's F-350 ruling: "the parser learns names").
//
// ⚠ WHAT WAS BROKEN. `session-dispatch.js › mentionedAgentIds` resolved `@<id>` and `@agent-<id>`
// and nothing else, while the renderer's picker INSERTS the operator's slugged custom name when
// there is one (`src/features/channels/lib/agent-mentions.ts › agentMentionHandle`) and the
// transcript TINTS it. So for every agent the operator had actually named — which, since the
// launch panel made a name the one required field, is very nearly all of them — the picker wrote
// a blue token this machine ignored, TIER 1 never fired, and the agent sat there. F-266's
// tint-says-tagged / stamp-says-nobody class, one namespace over.
//
// ⚠ WHY THE RENAME STORE IS THE RIGHT AUTHORITY AND THE ONLY ONE. A rename lives in
// `main/agent-names.js`, on THIS machine, keyed by an instance id minted on THIS machine. No
// server has it and no peer can have it. So the machine that owns the names is the only one that
// could ever resolve a name to an id — which is the same argument that made the @-mention rule
// safe in the first place, read from the other end.
//
// ── ONE RULE, TWO TREES, AND A HAND COPY — the `deep-link-target.js` pairing ──────────────────
//
// ⚠ MAIN CANNOT IMPORT THE SPA'S TYPESCRIPT, so {@link agentSlug} and {@link handleOf} are COPIES
// of `src/features/channels/lib/mentions.ts › mentionSlug` and `› mentionHandleOf`. A copy of a
// convention is a drift bomb — the failure is silent and looks exactly like "the agent ignored
// me" — so it is paired the way the route table is:
//
//   • `dopl-desktop-app/test/agent-handles.test.mjs`      drives THIS side over a shared fixture
//   • `src/features/channels/lib/agent-handle-parity.test.ts` drives the TS side over the SAME
//     fixture list, READ OUT OF THIS FILE'S SOURCE, and fails when the two disagree.
//
// **The fixtures are the contract; either tree changing the rule alone fails a suite.**
//
// ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────
//
// ⚠ IT WIDENS RECOGNITION AND NEVER LOOSENS THE REFUSAL (Samuel's constraint, verbatim). An
// unknown slug resolves to NOTHING and wakes nobody, exactly as before. Ambiguity — two agents on
// this machine renamed to the same slug — resolves to NEITHER, which is `lib/mentions.ts`'s rule 5
// and `agent-mentions.ts`'s, applied here for the same reason: the order a registry happens to
// iterate must not decide which agent a message wakes.
// ⚠ THE ID FORM IS NEVER WITHDRAWN and is not this file's business: `mentionedAgentIds` keeps its
// own anchored regex for `@<id>` / `@agent-<id>`, which is unambiguous by construction and still
// reaches an agent whose NAME is contested. This module only adds the second door.
// ⚠ IT IS PURE AND ELECTRON-FREE, like `agent-id.js`. The name STORE is injected
// ({@link handleIndexFor}'s `nameFor`), so the truth tables run with no disk and no electron, and
// `session-dispatch.js` — whose whole routing block is sliced by four harnesses — gains one free
// var rather than a `require` it could not hold.

// ─── BEGIN AGENT-HANDLES-PURE (pure; unit-tested via source extraction) ────────

/**
 * THE HANDLE CONVENTION — lowercase, whitespace runs to a single `-`.
 *
 * ⚠ HAND COPY OF `src/features/channels/lib/mentions.ts › mentionSlug`. "Research Bot" →
 * `research-bot`. Do not "improve" it on one side; see the pairing in this file's header.
 */
function agentSlug(source) {
  return String(source == null ? '' : source).trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * ⚠ HAND COPIES of `lib/mentions.ts › MENTION_TOKEN_RE` / `› TRAILING_HTML_TAG` /
 * `› TRAILING_PUNCTUATION`. The punctuation class carries `*`, `_` and `~` for F-266's reason:
 * `**@research-bot**` is how a person writes "look at this", it TINTS, and a class without them
 * would leave it stamping nobody — the same defect this whole file exists to close.
 */
const TOKEN_RE = /@[^\s@]+/g;
const TRAILING_HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*\s*\/?>$/;
// ⚠ THE THREE QUOTE CHARACTERS ARE WRITTEN AS ESCAPES — `\u0027` `'`, `\u0022` `"`, `\u0060`
// backtick — AND MUST STAY THAT WAY. They are the same class members either spelling; what the
// escapes buy is that `test/main-exports-defined.test.mjs` can still READ this file.
// That sweep blanks strings before it looks for bindings, and its blanker does not know a regex
// literal from code — so a literal quote inside this character class opens a "string" that
// swallows the rest of the file, and every function declared BELOW here becomes invisible to it.
// Measured: `handleOf`, `buildAgentHandleIndex` and `slugMentionedAgentIds` were all reported as
// exported-but-unbound until these three became escapes. The sweep is a real load-time-crash
// guard and disarming it for one file's convenience is the wrong trade; the escapes cost nothing.
const TRAILING_PUNCTUATION = /[.,:;!?\u0027\u0022\u0060)\]}>*_~]+$/;

/**
 * One `@token` -> the bare handle, or ''.
 *
 * ⚠ HAND COPY OF `lib/mentions.ts › mentionHandleOf`, LOOP AND ORDER INCLUDED. The HTML tag comes
 * off BEFORE the punctuation class, because `>` is in that class and stripping it first turns
 * `@research-bot</b>` into `@research-bot</b` — a shape nothing recovers. The loop repeats until
 * neither moves, because `**@research-bot**.` needs two passes.
 * ⚠ LEADING PUNCTUATION IS NOT STRIPPED, also verbatim: guessing where a handle STARTS is how an
 * `@` inside a URL becomes a tag.
 */
function handleOf(token) {
  const raw = String(token == null ? '' : token);
  if (!raw.startsWith('@')) return '';
  let handle = raw.slice(1);
  for (;;) {
    const before = handle;
    handle = handle.replace(TRAILING_HTML_TAG, '').replace(TRAILING_PUNCTUATION, '');
    if (handle === before) break;
  }
  return handle.toLowerCase();
}

/**
 * Live agents -> a SLUG index. Handle -> the agent id it names, or `null` when two claim it.
 *
 * ⚠ SLUGS ONLY, AND THAT IS THE SPLIT WITH `agent-mentions.ts › buildAgentMentionIndex`. That one
 * claims the `agent-<id>` form too because the renderer needs one index for both; here the id
 * forms belong to `mentionedAgentIds`' own anchored regex, which already intersects them with the
 * live roster. Claiming them twice would be two spellings of one rule — this file's whole subject.
 *
 * ⚠ AN UNNAMED AGENT CLAIMS NOTHING. `agentSlug('')` is `''`, which is never a handle, so an agent
 * the operator never renamed simply has no entry — and reaches its `@agent-<id>` door as always.
 * ⚠ AMBIGUITY IS `null`, NOT "first wins". Two agents renamed "Twin" resolve to NEITHER.
 */
function buildAgentHandleIndex(entries) {
  const index = new Map();
  for (const entry of entries || []) {
    const agentId = String((entry && entry.agentId) || '').trim().toLowerCase();
    if (!agentId) continue;
    const handle = agentSlug(entry && entry.displayName);
    if (!handle) continue;
    if (!index.has(handle)) {
      index.set(handle, agentId);
      continue;
    }
    const held = index.get(handle);
    if (held !== null && held !== agentId) index.set(handle, null);
  }
  return index;
}

/**
 * Every agent id a body NAMES BY SLUG, de-duped, in first-appearance order.
 *
 * ⚠ THE INDEX IS ALREADY INTERSECTED WITH THE LIVE ROSTER by its builder, so a hit here is an
 * agent that exists on this thread — the same property the id-form regex gets from its own
 * `liveIds` intersection, and the reason neither path can be made to name a dead or foreign agent.
 * ⚠ A MISS IS SILENT AND IS THE FAIL-CLOSED DIRECTION: an unknown slug, an ambiguous one (`null`),
 * or a token that is not a handle at all all contribute nothing and wake nobody.
 */
function slugMentionedAgentIds(body, index) {
  const out = [];
  if (!index || index.size === 0) return out;
  const text = String(body == null ? '' : body);
  const tokens = text.match(TOKEN_RE);
  if (!tokens) return out;
  for (const token of tokens) {
    const handle = handleOf(token);
    if (!handle) continue;
    const agentId = index.get(handle);
    if (!agentId) continue; // undefined = unknown, null = ambiguous. Both wake nobody.
    if (!out.includes(agentId)) out.push(agentId);
  }
  return out;
}

/**
 * THE CROSS-TREE CONTRACT, AS DATA — the `deep-link-target.js` pairing's fixture half.
 *
 * ⚠ ONE LIST, TWO SUITES, AND IT LIVES HERE BECAUSE THE COPY DOES. `agentSlug` and `handleOf` are
 * hand copies of `src/features/channels/lib/mentions.ts › mentionSlug` / `› mentionHandleOf`, and
 * a hand copy with no shared fixture is a rule that drifts silently. Both sides read THIS array:
 *
 *   • `dopl-desktop-app/test/agent-handles.test.mjs`             — drives these functions
 *   • `src/features/channels/lib/agent-handle-parity.test.ts`    — SLICES the pure block above out
 *     of this file, runs it, and asserts it agrees with the TypeScript on every row
 *
 * So a change on either side fails a suite, and there is no way to "fix" one tree alone.
 *
 * ⚠ EVERY ROW IS A RULE SOMEBODY COULD PLAUSIBLY GET WRONG, not filler: whitespace collapsing,
 * case, the F-266 emphasis characters, the HTML tag BEFORE punctuation ordering, the two-pass
 * loop, and leading punctuation deliberately NOT stripped.
 * ⚠ BOTH SUITES ASSERT THE LENGTH, so deleting a row to make a failure go away fails too.
 */
const PARITY_NAMES = [
  "Research Bot",
  "  Research   Bot  ",
  "RESEARCH BOT",
  "Scout",
  "deploy bot 2",
  "",
  "   ",
];

const PARITY_TOKENS = [
  "@research-bot",
  "@research-bot.",
  "@research-bot,",
  "@research-bot?",
  "@research-bot!",
  "@**research-bot**",
  "@research-bot**.",
  "@research-bot</b>",
  "@research-bot</b>.",
  "@research-bot~~",
  "@research-bot_",
  "@RESEARCH-BOT",
  "@(research-bot",
  "@",
  "research-bot",
];

// ─── END AGENT-HANDLES-PURE ───────────────────────────────────────────────────

/**
 * THE LIVE HALF: the slug index for the agents on this thread, read off the rename store.
 *
 * ⚠ `nameFor` IS INJECTED AND DEFAULTS TO THE STORE, so the pure block above needs no `require`
 * and the truth tables need no disk. Production passes nothing and gets `agent-names.js`.
 * ⚠ A NAME LOOKUP MUST NEVER DECIDE A WAKE BY THROWING. `agent-names.js` is electron-store backed
 * and an unreadable store is a reason to resolve FEWER handles — never a reason to take the
 * routing path down.
 */
function handleIndexFor(agentIds, nameFor) {
  const resolve = typeof nameFor === 'function'
    ? nameFor
    : (id) => require('./agent-names').displayNameFor(id);
  const entries = [];
  for (const raw of agentIds || []) {
    const agentId = String(raw || '');
    if (!agentId) continue;
    let displayName = '';
    try {
      displayName = resolve(agentId) || '';
    } catch (err) {
      // ⚠ **THE DIAGNOSTIC MUST NOT BECOME THE FAILURE.** `diag` is electron-backed, and
      // this catch exists precisely for contexts where the electron side is absent — the
      // default `nameFor` above requires `agent-names`, which requires `electron-store`.
      // Where that throws, `require('./diag')` throws too (it requires `electron`), so the
      // handler re-raised out of the block and took down THE ROUTING PATH THE CATCH EXISTS
      // TO PROTECT — the exact failure the header two comments up forbids. It fired in CI
      // (`delivery-composed.test.ts`, ubuntu, where the desktop's deps are not installed)
      // and would fire in any packaged context missing either module.
      try {
        require('./diag').diag('agent-handles: name lookup failed', err && err.message);
      } catch (_) {
        /* no diag sink reachable here — resolving FEWER handles is the documented answer */
      }
    }
    entries.push({ agentId: agentId, displayName: displayName });
  }
  return buildAgentHandleIndex(entries);
}

module.exports = {
  agentSlug,
  handleOf,
  buildAgentHandleIndex,
  slugMentionedAgentIds,
  handleIndexFor,
  // the cross-tree fixture table — read by BOTH suites, never by production
  PARITY_NAMES,
  PARITY_TOKENS,
};
