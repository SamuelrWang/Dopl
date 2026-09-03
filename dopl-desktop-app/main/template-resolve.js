// THE AGENT-TEMPLATE LAUNCH RESOLVE — `GET /api/agent-templates/{id}/resolve`, at spawn.
//
// ── ⚠ WHO FETCHES TEMPLATE CONTENT, AND WHEN: THE DESKTOP, AT SPAWN. ─────────────────────────
//
// The renderer passes an ID. `main` resolves it here, itself, before `launchRequesterSession`.
// A renderer-supplied SNAPSHOT was the alternative and it is refused, for four reasons in
// decreasing weight:
//
//   1. IT IS THIS LANE'S EXISTING ARCHITECTURE. Every security-relevant input on the button
//      lane is computed by main from MAIN'S OWN STATE, specifically so the renderer cannot
//      influence it: the tool profile from `targeting.resolveToolProfile(listener.watchedChannel
//      (...))`, the start modes and the model from `channel-prefs.js`, the goal from three canned
//      strings. F-267 IS THE SCAR — main read a PROJECTION instead of its own DTO and every
//      button launch silently floored to `read_only`. A renderer-supplied template snapshot is
//      that same mistake with PROMPT TEXT.
//   2. TRUST. A snapshot from the renderer is renderer-authored text landing in a prompt, and
//      main cannot tell a real template from a fabricated one. An ID it resolves itself, it can.
//   3. THE VIEWER FILTER IS THE OPERATOR'S, AND IT HAS TO BE. `knowledgeBases` is filtered
//      against the RESOLVING CALLER's KB visibility, so a shared template cannot launder access
//      to a private base. Resolving in the SPA and resolving here both run as the operator
//      today — but only this call is STRUCTURALLY guaranteed to, and the orchestrator lane
//      (§3e) introduces a shape where the SELECTOR's caller and the OPERATOR are different
//      people. One resolution point, always the operator's credential.
//   4. FRESHNESS. Content is read at spawn, so an edit landed 200 ms ago is honoured.
//
// ⚠ THE SPA MAY STILL RENDER THE NAME OPTIMISTICALLY from its own list cache. That costs nothing
// and gives back the round trip the snapshot argument wanted: the optimistic render is a LABEL,
// this resolve is the PROMPT.
//
// ⚠ IT RIDES `api.js › apiFetch`, which is COOKIE-authed and carries the shared 401 repair
// (`api-repair.js`; a second copy of that repair produced the 1.8.x Channels outage) plus the
// app-version stamp. Never a raw fetch. ⚠ AND NOT THE DEVICE TOKEN: `mcp-config.js ›
// deviceTokenForSpawn` is the MCP bearer and nothing else. Both resolve to the same `userId`, so
// the BEHAVIOUR the route's docblock describes is right; the mechanism it names is not (G-2).

const { apiFetch } = require('./api');
const { diag } = require('./diag');

// ⚠ FIVE SECONDS, NOT `launch-directives.js`'s `HTTP_TIMEOUT_MS = 15000`. This one is held open
// by a BUTTON CLICK: fifteen seconds of a dead-looking New Agent button is worse than a refusal
// the operator can act on, and the refusal it produces (`busy`) already reads as "try again".
// The directive lane has no human waiting and can afford the longer budget.
const TEMPLATE_RESOLVE_TIMEOUT_MS = 5000;

// Bounds on what may come back off the wire and into a prompt. The server enforces its own
// (`agent-templates/schema.ts`) — these are the BOUNDARY's, because a boundary that trusts the
// far side's validation is not one.
const MAX_INSTRUCTIONS = 32768; // the column's own CHECK
const MAX_FIELDS = 50; // MAX_FIELD_COUNT
const MAX_BASES = 50;

// ── ⚠ ONE BOUND PER FIELD, EACH THE SERVER'S OWN (F-287, 2026-08-23) ────────────────────────
//
// ⚠ THIS USED TO BE A SINGLE `MAX_LABEL = 200`, under the comment "names, keys and values are
// SAFE_LABEL_RE-bounded well inside this". That was FALSE for `value`, whose schema bound is
// **1000** — so a legal 300-character field value was clipped to 200 here and then to 80 again by
// the render belt, and the operator was told nothing at any surface.
// ⚠ A BOUNDARY BOUND MUST MATCH THE WRITER'S, NOT UNDERCUT IT. A boundary exists so this machine
// does not trust the far side's validation; enforcing a SMALLER number than the far side enforces
// is not extra caution, it is this module inventing a limit the operator can neither see nor
// satisfy. Where the two disagree, the disagreement is silent and always resolves against them.
const MAX_NAME = 120; // `schema.ts › NameSchema` / `agent_templates_name_charset_check`
const MAX_FIELD_KEY = 80; // `schema.ts › TemplateFieldSchema.key`
const MAX_FIELD_VALUE = 1000; // …and its `.value`
const MAX_MODEL = 120; // an id or an alias; `session-model.js` re-coerces it anyway
const MAX_BASE_LABEL = 200; // a base id or slug and its display name — neither reaches a prompt
                            // line unsanitized (`prompt-framing-template.js › knowledgeLines`)
const MAX_TENANCY_LABEL = 200; // a workspace name (120) or a container id in a fixed phrase — a
                               // DIAGNOSTIC string (T35), and it reaches no prompt at all

// ⚠ THE SHARED UUID RULE, NEVER A LOCAL COPY. `test/uuid-rule-parity.test.mjs` is a CENSUS of
// every file in `main/` that spells the rule itself, and its standing instruction is that a new
// entry is a REVIEW rather than a rename: `ipc-guards.js › isUuid` is importable by anything
// that is not inside a sliced pure block, and this module is not one.
const { isUuid } = require('./ipc-guards');

function isTemplateId(value) {
  return isUuid(value);
}

/** Bounded text, at the bound the CALLER names. ⚠ There is no default: every call site above has
 *  a real server bound and picking one for it is how the 200 got here. */
function label(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/**
 * Narrow the wire payload to the six keys the ROLE BLOCK reads, and nothing else.
 *
 * ⚠ A LITERAL WHITELIST, NOT A SPREAD, for the reason `session-launch.js › launch` gives for its
 * own: a key this list omits is DROPPED, so a field the server adds later cannot arrive on a
 * session object and start being depended on by accident. It is also the shape that keeps a
 * future `createdBy` (or any other ownership fact) out of a launch payload it has no business in.
 * ⚠ NULLS ARE PRESERVED AS NULLS. The launch contract's own test pins that nullable fields travel
 * as `null` rather than being omitted, and a consumer distinguishing "absent" from "null" is a
 * consumer with two code paths for one state.
 */
function narrow(body) {
  const b = body && typeof body === 'object' ? body : {};
  const fields = Array.isArray(b.fields) ? b.fields.slice(0, MAX_FIELDS) : [];
  const bases = Array.isArray(b.knowledgeBases) ? b.knowledgeBases.slice(0, MAX_BASES) : [];
  return {
    name: label(b.name, MAX_NAME),
    instructions: typeof b.instructions === 'string' ? b.instructions.slice(0, MAX_INSTRUCTIONS) : null,
    model: typeof b.model === 'string' ? label(b.model, MAX_MODEL) : null,
    fields: fields
      .filter((f) => f && typeof f === 'object')
      .map((f) => ({ key: label(f.key, MAX_FIELD_KEY), value: label(f.value, MAX_FIELD_VALUE) })),
    knowledgeBases: bases
      .filter((k) => k && typeof k === 'object')
      .map((k) => ({ id: label(k.id, MAX_BASE_LABEL), name: label(k.name, MAX_BASE_LABEL) })),
    // ⚠ G-1, AND IT FAILS FOREIGN. `authoredByCaller` decides which SECURITY HEADER the role
    // block wears, so anything that is not an explicit `true` — an older server that does not
    // send the field, a malformed body, a proxy that dropped it — gets the STRONGER header.
    // The failure direction of a wrong guess here is a redundant caution, never a missing one.
    authoredByCaller: b.authoredByCaller === true,
  };
}

/**
 * The server's own tenancy classification off a 404 body, or null. NEVER THROWS AND NEVER GUESSES.
 *
 * ⚠ A BOUNDARY READ, so it is bounded like every other one in this file: two short strings, sliced,
 * and anything that is not a pair of non-empty strings is `null`. This text is diagnostic and
 * operator-facing on this machine; the AGENT-facing sentence is written server-side.
 */
async function tenancyHint(res) {
  let body = null;
  try { body = await res.json(); } catch (_err) { return null; }
  const raw = body && body.error && body.error.details && body.error.details.elsewhere;
  if (!raw || typeof raw !== 'object') return null;
  const name = label(raw.name, MAX_NAME);
  const where = label(raw.label, MAX_TENANCY_LABEL);
  return name && where ? { name, label: where } : null;
}

/**
 * Resolve a template for a spawn. Never throws.
 *
 * ANSWERS, and they are the F-1…F-6 table from the spec, verbatim:
 *   { ok: true, template }              a resolvable template, narrowed (F-6: a NAME-ONLY
 *                                       template is legal and launches — the role block emits
 *                                       the identity line and nothing else)
 *   { ok: false, reason: 'no-template' } 404. ⚠ DELETED AND INVISIBLE ARE THE SAME ANSWER
 *                                       (F-1 / F-2) and the desktop must not try to tell them
 *                                       apart: the endpoint is 404-never-403 precisely so the
 *                                       difference is not observable, and a caller that guessed
 *                                       would be reconstructing the oracle.
 *   { ok: false, reason: 'busy' }        timeout, network, or 5xx (F-3 / F-4). An existing word:
 *                                       `use-agents-panel.ts` already renders it as "Busy right
 *                                       now — try again", which is exactly a momentary inability.
 *   { ok: false, reason: 'no-template' } a 2xx whose body is not a usable template. Unreachable
 *                                       against the real route; the branch exists because the
 *                                       alternative is launching an agent wearing an empty
 *                                       identity, and F-1's whole argument is that a blank agent
 *                                       silently wearing no identity is worse than a refusal.
 *
 * ⚠ THERE IS NO "DEGRADE TO BLANK" ANSWER ON ANY BRANCH. The operator PICKED an identity; a
 * launch that quietly drops it is not noticed for several turns.
 */
async function resolveTemplate(templateId, workspaceId) {
  if (!isTemplateId(templateId)) return { ok: false, reason: 'no-template' };
  let res;
  try {
    res = await apiFetch(`/api/agent-templates/${templateId}/resolve`, {
      method: 'GET',
      workspaceId: typeof workspaceId === 'string' ? workspaceId : undefined,
      timeoutMs: TEMPLATE_RESOLVE_TIMEOUT_MS,
      noStore: true,
    });
  } catch (err) {
    // An abort (the timeout) and a dead socket land here identically, and so they should:
    // both are "this machine could not ask right now".
    diag('template-resolve: network', String(templateId).slice(0, 8), (err && err.message) || 'error');
    return { ok: false, reason: 'busy' };
  }
  if (!res) return { ok: false, reason: 'busy' };
  if (res.status === 404) {
    // ⚠ THREE CAUSES, ONE WORD, AND THE THIRD IS THE COMMON ONE. `workspaceId` scopes this read to
    // the CHANNEL's tenancy — a home channel's own `kind='link'` container — and the route reads
    // `(workspace_id, id)`, so a template this operator owns in ANOTHER workspace (their personal
    // shelf included) is ABSENT here, not hidden. Deleted / not visible / wrong tenancy stay ONE
    // `reason` on purpose: 404-never-403 is what stops an id being probed, and this machine must
    // not guess between them.
    //
    // ⚠ BUT THE SERVER MAY HAND BACK THE THIRD ONE NAMED (T35). `details.elsewhere` is present
    // only when the row is one THIS OPERATOR could already list for themselves — their own, or
    // `workspace`-visible, in a workspace they belong to — living in another tenancy
    // (`agent-templates/server/service-resolve-ref.ts › classifyMissingTemplateRef` is the fence).
    // It is a CLASSIFICATION THE SERVER MADE, never one this machine infers, so carrying it
    // reconstructs no oracle: absent means "nothing non-leaky to say", which is also what an older
    // server sends.
    const elsewhere = await tenancyHint(res);
    diag(
      'template-resolve: 404',
      String(templateId).slice(0, 8),
      elsewhere ? `— lives in ${elsewhere.label}, not this channel's container` : '— deleted, not visible to this operator, or in another container'
    );
    // ⚠ THE WORD DOES NOT MOVE, AND THAT IS THE WIRE'S LIMIT RATHER THAN A CHOICE: a decide carries
    // a refusal REASON out of a closed vocabulary and no free text, so `elsewhere` cannot reach the
    // orchestrator from here. What reaches it is `channel-ops-launch.ts › REFUSAL_SENTENCES` —
    // which states the same TENANCY RULE, in the same shape, for exactly this reason.
    return elsewhere
      ? { ok: false, reason: 'no-template', elsewhere }
      : { ok: false, reason: 'no-template' };
  }
  if (!res.ok) {
    // ⚠ EVERY OTHER NON-2xx IS `busy`, 4xx INCLUDED. A 401 that survived the shared repair, a
    // 403 from a workspace header this machine got wrong, a 400: none of them means the template
    // is gone, and telling the operator to "reload the list" would send them to fix the wrong
    // thing. `busy` says "not now", which is true of all of them.
    diag('template-resolve: HTTP', res.status, String(templateId).slice(0, 8));
    return { ok: false, reason: 'busy' };
  }
  let body = null;
  try { body = await res.json(); } catch (_err) { body = null; }
  const template = narrow(body);
  if (!template.name) {
    diag('template-resolve: unusable payload', String(templateId).slice(0, 8));
    return { ok: false, reason: 'no-template' };
  }
  return { ok: true, template };
}

// ── ⚠ THE LAUNCH SHEET'S EPHEMERAL OVERRIDES, RE-VALIDATED HERE (2026-08-22, F-281) ─────────
//
// The launch sheet lets an operator re-point THIS SPAWN's model and custom-field VALUES without
// touching the durable row. Nothing below is ever written back to the template.
//
// ⚠ MAIN IS THE ONLY REAL VALIDATOR, AND THAT IS A MEASURED FACT RATHER THAN A POSTURE.
// `@/shared/lib/safe-label` exports `SAFE_LABEL_RE` from a module body that imports **zod**, and
// `agent-templates/client/types.ts` forbids a value import from that family because it "would
// drag the validator into the renderer" (the desktop SPA bundles those files). So the SPA
// enforces only the NUMBERS and relies on single-line `<input>` elements; the CHARSET rule is
// checked here, against the one copy of it this tree has
// (`session-telemetry.js › UNSAFE_LABEL_RE`, the complement of the server's own, character for
// character). F-281 records the shape and the fix.
//
// ⚠ THIS IS RENDERER-AUTHORED TEXT ON ITS WAY INTO A PROMPT — the one input on this lane that
// is, and the reason the template CONTENT is resolved by main rather than snapshotted. Fields
// resolved FROM THE SERVER already passed `SAFE_LABEL_RE` at write time; these did not pass it
// anywhere.
//
// ⚠ A BAD ROW IS DROPPED, NOT A REFUSED LAUNCH. It is the same answer the sheet's own
// `boundOverrideFields` gives a row with an empty key, and the belt still runs at render
// (`prompt-framing-template.js › fieldLines` re-sanitizes both halves). Refusing the spawn over
// a pasted zero-width would be a launch the operator cannot fix from the sheet they are in.
const { UNSAFE_LABEL_RE } = require('./session-telemetry');

const MAX_OVERRIDE_KEY = 80; // `schema.ts › TemplateFieldSchema.key`
const MAX_OVERRIDE_VALUE = 1000; // …and its `value`

/** The server's short-label charset, asked as a question. `''` is SAFE: an empty value is a
 *  legitimate half-filled form and the schema allows it. */
function isSafeLabel(value) {
  if (typeof value !== 'string') return false;
  UNSAFE_LABEL_RE.lastIndex = 0; // ⚠ the shared regex carries /g; a stale index answers wrongly
  return !UNSAFE_LABEL_RE.test(value);
}

/**
 * Narrow the renderer's override object to what may reach a spawn.
 *
 * ⚠ ABSENT IS THE ONLY SPELLING OF "NO OVERRIDE", on both keys — the sheet's own contract. An
 * untouched sheet and a plain row click therefore produce BYTE-IDENTICAL launches, which is what
 * keeps the one-click lane one click.
 * ⚠ `fields` REPLACES, never merges. The sheet edits values over a fixed key set, so a merge
 * would be a second reconciliation rule for a set that already agrees; and a partial merge over
 * a set the operator can edit is how two field lists silently diverge.
 *
 * Answers `{ model: '' | <alias>, fields: null | [{key, value}] }` — `model` already coerced
 * onto the alias vocabulary, `''` meaning "the chain continues".
 */
function narrowOverrides(overrides) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const sessionModel = require('./session-model');
  const asked = typeof o.model === 'string' ? o.model : '';
  const alias = asked ? sessionModel.normalizeModel(asked) : 'default';
  const out = { model: alias === 'default' ? '' : alias, fields: null };
  if (!Array.isArray(o.fields)) return out;
  const kept = [];
  const seen = new Set();
  for (const f of o.fields.slice(0, MAX_FIELDS)) {
    if (!f || typeof f !== 'object') continue;
    const key = typeof f.key === 'string' ? f.key.trim().slice(0, MAX_OVERRIDE_KEY) : '';
    const value = typeof f.value === 'string' ? f.value.trim().slice(0, MAX_OVERRIDE_VALUE) : '';
    // A keyless row names nothing; a duplicate key is the shape `TemplateFieldsSchema` refuses.
    if (!key || seen.has(key)) continue;
    if (!isSafeLabel(key) || !isSafeLabel(value)) {
      diag('template-resolve: dropped an override field whose charset the server would refuse');
      continue;
    }
    seen.add(key);
    kept.push({ key, value });
  }
  out.fields = kept;
  return out;
}

/**
 * The template this spawn actually runs as: the resolved row with the sheet's field overrides
 * substituted. ⚠ MODEL IS NOT APPLIED HERE — it belongs to the PRECEDENCE CHAIN, which is
 * computed once in `session-launch-op.js` and must not be half-resolved in two places.
 * ⚠ `null` template in, `null` out: a BLANK agent may still carry a model override (the sheet
 * opens on `Blank agent` too), and that is the chain's business, not this function's.
 */
function applyOverrides(template, narrowed) {
  if (!template) return null;
  const fields = narrowed && narrowed.fields;
  return fields ? { ...template, fields } : template;
}

module.exports = {
  resolveTemplate,
  isTemplateId,
  narrow, // exported so the whitelist can be driven directly, without a fake transport
  tenancyHint, // T35: the server's own "it lives elsewhere" classification, read off a 404 body
  narrowOverrides, // 2026-08-22: the launch sheet's ephemeral re-points, re-validated main-side
  applyOverrides,
  isSafeLabel, // the server's charset, as this tree's single copy answers it
  TEMPLATE_RESOLVE_TIMEOUT_MS,
};
