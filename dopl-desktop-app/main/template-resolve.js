// THE AGENT-TEMPLATE LAUNCH RESOLVE — `GET /api/agent-templates/{id}/resolve`, at spawn.
//
// ── 🔒 WHO FETCHES TEMPLATE CONTENT, AND WHEN: THE DESKTOP, AT SPAWN. ────────────────────────
//
// The renderer passes an ID; `main` resolves it here before `launchRequesterSession`. A
// renderer-supplied SNAPSHOT is refused, in decreasing weight:
//
//   1. IT IS THIS LANE'S ARCHITECTURE — every security-relevant input on the button lane is
//      computed by main from MAIN'S OWN STATE (tool profile, start modes, model, goal). F-267 IS
//      THE SCAR: main read a PROJECTION instead of its own DTO and every button launch silently
//      floored to `read_only`. A renderer snapshot is that mistake with PROMPT TEXT.
//   2. TRUST — main cannot tell a real template from a fabricated one; an ID it resolves, it can.
//   3. THE VIEWER FILTER IS THE OPERATOR'S. `knowledgeBases` is filtered against the RESOLVING
//      caller's KB visibility, so a shared template cannot launder access to a private base. Only
//      this call is STRUCTURALLY the operator's, and the orchestrator lane (§3e) introduces a
//      shape where the SELECTOR's caller and the OPERATOR are different people.
//   4. FRESHNESS — an edit landed 200 ms ago is honoured.
//
// ⚠ The SPA may still render the name optimistically from its list cache: that render is a LABEL,
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
// ⚠ 200, THE SERVER'S OWN `MAX_KNOWLEDGE_SCOPES` (`agent-templates/schema.ts`), and NOT 50. The
// base cap counts BASES; this counts SCOPES, and one base can contribute many folders. A smaller
// number here would be this module quietly deciding the operator's role names less knowledge than
// it names — the F-287 mistake, on a different field.
const MAX_SCOPES = 200;
// A base id, a folder/entry id, a display name, or a `/`-joined knowledge path. ⚠ The PATH is the
// long one: `knowledge_folders.name` and `knowledge_entries.title` are each bounded server-side and
// a path is several of them, so this is deliberately roomier than `MAX_BASE_LABEL`.
const MAX_SCOPE_PATH = 500;

// ── THE BASE CARD'S BOUNDS (2026-09-18, A4), EACH THE SERVER'S OWN ──────────
const MAX_BASE_SLUG = 80; // `knowledge/schema.ts` — the slug column's own max
const MAX_CARD_SUMMARY = 300; // `@/config › DESCRIPTION_MAX`, the bound the card is SENT at
const MAX_FOLDER_NAME = 200; // `knowledge/schema.ts › KnowledgeFolder.name`
const MAX_CARD_FOLDERS = 50; // `service-knowledge-scopes.ts › MAX_CARD_FOLDERS`
// ⚠ A CEILING ON THE *COUNT*, AND IT MUST STAY WELL ABOVE `MAX_CARD_FOLDERS`. The renderer proves a
// folder list is COMPLETE by comparing the two, so a ceiling at or below the list cap would clamp a
// truncated list into agreement and turn the completeness check into a rubber stamp.
const MAX_FOLDER_COUNT = 10000;

// ── 🔒 ONE BOUND PER FIELD, EACH THE SERVER'S OWN (F-287, 2026-08-23) ───────────────────────
//
// ⚠ A BOUNDARY BOUND MUST MATCH THE WRITER'S, NOT UNDERCUT IT. One shared `MAX_LABEL = 200`
// clipped a legal 300-character field value (schema bound: 1000) with no word to the operator at
// any surface. Enforcing a SMALLER number than the far side is not extra caution — it is a limit
// the operator can neither see nor satisfy, and the disagreement always resolves against them.
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
 * A CARD FACT: whole, or gone. ⚠ **THE ONE PLACE THIS BOUNDARY MUST NOT `slice`.**
 *
 * Every other bounded value here is prose or a label, where a clip costs the tail of a sentence.
 * A card fact is read as a COMPLETE statement about a base — its slug is an ADDRESS, its summary
 * is "what this base answers" — so the half that survives a slice reads exactly like the whole
 * thing and is wrong in a way the agent cannot detect. The server already sends these
 * all-or-nothing (`service-knowledge-scopes.ts › baseCard`); this is the same rule, restated at
 * the boundary, because a boundary that trusts the far side's discipline is not one.
 */
function whole(value, max) {
  return typeof value === 'string' && value.length <= max ? value : '';
}

/**
 * The card's TOP-LEVEL FOLDERS, narrowed to `{name, summary}` and nothing else.
 *
 * ⚠ **A MALFORMED ROW IS DROPPED, AND DROPPING IT IS SAFE ONLY BECAUSE `baseFolderCount` NOTICES.**
 * A folder this loop refuses leaves the list SHORTER than the count the server sent, and the
 * renderer prints the folder line only when the two agree — so a dropped row costs the whole line
 * rather than producing a list that silently omits one.
 * ⚠ AND NO ENTRIES, EVER. The allowlist is what makes "the card lists zero entries" a property of
 * the shape rather than a promise about the server: a future payload carrying `entries` beside
 * these keys is dropped here and cannot reach a line of prompt text.
 */
function cardFolders(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const f of value.slice(0, MAX_CARD_FOLDERS)) {
    if (!f || typeof f !== 'object') continue;
    const name = whole(f.name, MAX_FOLDER_NAME);
    if (!name) continue;
    out.push({ name, summary: whole(f.summary, MAX_CARD_SUMMARY) });
  }
  return out;
}

/**
 * A COUNT OFF THE WIRE — a non-negative integer or 0, never NaN and never a float.
 *
 * ⚠ 0 IS THE FAIL DIRECTION ON PURPOSE. An older server does not send the key, a proxy may drop
 * it, and a garbled one must not become a prompt line claiming knowledge is missing. A wrong
 * guess here costs a sentence the agent did not say; the opposite would be a role block telling
 * an agent it has been denied something nobody attached.
 */
function count(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), typeof max === 'number' ? max : MAX_BASES);
}

/**
 * Narrow the wire payload to the eight keys the ROLE BLOCK reads, and nothing else.
 *
 * ⚠ EACH `knowledge` SCOPE GAINED THE FOUR BASE-CARD KEYS ON 2026-09-18 (A4) — `baseSlug`,
 * `baseSummary`, `baseFolders` and `baseFolderCount`. They are NOT a ninth top-level key: a card
 * describes ONE attachment, so it rides the scope it is about. See `whole` / `cardFolders` above
 * for why two of them refuse to `slice`.
 *
 * ⚠ THE EIGHTH IS `knowledge` (2026-09-08) — every attached scope, base / folder / entry — and it
 * rides BESIDE `knowledgeBases` rather than replacing it: an older SERVER sends only the base
 * list. `knowledgeLines` prefers `knowledge` when non-empty and falls back, so one of the two
 * always answers and neither is rendered twice.
 * ⚠ THE SEVENTH IS `unreachableKnowledgeBaseCount` (2026-09-05), a COUNT BY CONTRACT: the server
 * withholds the id, name and container of an unreachable base, and this narrow is the second gate
 * on that — anything added beside the number is dropped before it reaches prompt text.
 *
 * ⚠ A LITERAL WHITELIST, NOT A SPREAD (the reason `session-launch.js › launch` gives for its own):
 * an omitted key is DROPPED, so a field the server adds later cannot start being depended on by
 * accident — and a future `createdBy` cannot reach a launch payload it has no business in.
 * ⚠ NULLS ARE PRESERVED AS NULLS — a consumer distinguishing "absent" from "null" is a consumer
 * with two code paths for one state.
 */
function narrow(body) {
  const b = body && typeof body === 'object' ? body : {};
  const fields = Array.isArray(b.fields) ? b.fields.slice(0, MAX_FIELDS) : [];
  const bases = Array.isArray(b.knowledgeBases) ? b.knowledgeBases.slice(0, MAX_BASES) : [];
  const scopes = Array.isArray(b.knowledge) ? b.knowledge.slice(0, MAX_SCOPES) : [];
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
    // ⚠ A LITERAL WHITELIST INSIDE THE WHITELIST, for the reason the outer one exists: the server's
    // ref also carries `folderId`, `entryId`, `folderName`, `entryTitle` and a DISPLAY `path`, and
    // none of them is read here. `scope`, `baseId`, `baseName` and `toolPath` are what the four
    // rendered forms need; anything else the server adds is dropped rather than reaching a line of
    // prompt text by accident.
    // ⚠ `scope` FAILS TO `'base'`, never to a folder or an entry. An unknown discriminator from a
    // newer server renders the whole-base call, which is the WIDER instruction and therefore the one
    // that cannot point an agent at a document that does not exist.
    // ⚠ THE FOUR CARD KEYS JOINED 2026-09-18 (A4) AND THEY RIDE THE BASE SCOPE ALONE. A folder or
    // entry scope already names the exact thing it points at, so a card over one would be noise on
    // top of an answer — and a key that reaches no renderer is a key a later reader starts
    // depending on. The server sends them only on a whole-base scope; this narrow enforces it
    // rather than trusting it, which is the reason the outer whitelist exists at all.
    knowledge: scopes
      .filter((k) => k && typeof k === 'object')
      .map((k) => {
        const scope = k.scope === 'folder' || k.scope === 'entry' ? k.scope : 'base';
        const ref = {
          scope,
          baseId: label(k.baseId, MAX_BASE_LABEL),
          baseName: label(k.baseName, MAX_BASE_LABEL),
          toolPath: label(k.toolPath, MAX_SCOPE_PATH),
        };
        if (scope !== 'base') return ref;
        return {
          ...ref,
          baseSlug: whole(k.baseSlug, MAX_BASE_SLUG),
          baseSummary: whole(k.baseSummary, MAX_CARD_SUMMARY),
          baseFolders: cardFolders(k.baseFolders),
          baseFolderCount: count(k.baseFolderCount, MAX_FOLDER_COUNT),
        };
      }),
    // ⚠ HOW MANY ATTACHMENTS THIS OPERATOR CANNOT REACH HERE — see `count` above and
    // `prompt-framing-template.js › knowledgeLines`, its one consumer.
    unreachableKnowledgeBaseCount: count(b.unreachableKnowledgeBaseCount),
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
 * ⚠ `instructions` JOINED 2026-09-13 (Samuel: *"we should add an Instructions field in the New agent
 * popup"* — the field that replaced the deleted launch sheet's read-only disclosure). It is PROSE,
 * so unlike `fields` it takes NO charset rule: `agent-templates/schema.ts › InstructionsSchema` is
 * `safeOptionalProse` and a newline is legal in it. What it takes is the COLUMN's own bound, and
 * `''` is "no override" — the popup sends the key only when the operator's text differs from the
 * template's own (`channels/components/use-agent-launch-run.ts › launchOverridesOf`).
 *
 * Answers `{ model: '' | <alias>, instructions: '' | <prose>, fields: null | [{key, value}] }` —
 * `model` already coerced onto the alias vocabulary, `''` meaning "the chain continues".
 */
function narrowOverrides(overrides) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const sessionModel = require('./session-model');
  const asked = typeof o.model === 'string' ? o.model : '';
  const alias = asked ? sessionModel.normalizeModel(asked) : 'default';
  const instructions = typeof o.instructions === 'string'
    ? o.instructions.slice(0, MAX_INSTRUCTIONS).trim()
    : '';
  const out = { model: alias === 'default' ? '' : alias, instructions, fields: null };
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
 * The template this spawn actually runs as: the resolved row with the popup's field and
 * instructions overrides substituted. ⚠ MODEL IS NOT APPLIED HERE — it belongs to the PRECEDENCE
 * CHAIN, which is computed once in `session-launch-op.js` and must not be half-resolved in two
 * places.
 * ⚠ `null` template in: a BLANK agent may still carry a model override (the chain's business,
 * not this function's) — and, since F-695 was RULED on 2026-09-13, its typed `instructions`
 * come out as an INSTRUCTIONS-ONLY template (`instructionsOnly: true`, no name) that
 * `prompt-framing-template.js › instructionsOnlyFraming` frames without a role line.
 * ⚠ **THE INSTRUCTIONS ARE SUBSTITUTED AFTER THE APPROVAL GATE — the ordering that gate's own
 * comment demands, and it is what keeps the question honest.** What a foreign template's first use
 * asks the operator to accept is the text THEY DID NOT WRITE; splicing their own edit in first
 * would put renderer text in front of that question. `authoredByCaller` is deliberately NOT flipped
 * by an edit either: it is the SERVER's boolean about the ROW, and the framing fails FOREIGN.
 */
function applyOverrides(template, narrowed) {
  const instructions = (narrowed && narrowed.instructions) || '';
  if (!template) {
    // F-695 RULED (Samuel, 2026-09-13): the field starts EMPTY on a blank launch, and
    // whatever the operator types is carried as an instructions-only role — no name,
    // no fields, no knowledge; `prompt-framing-template.js › instructionsOnlyFraming`
    // frames it without a role line. Nothing typed → still no template.
    return instructions
      ? { name: null, instructions, authoredByCaller: true, instructionsOnly: true, fields: null }
      : null;
  }
  const fields = narrowed && narrowed.fields;
  const next = fields ? { ...template, fields } : template;
  return instructions ? { ...next, instructions } : next;
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
