// The agent-identity launch resolve: `GET /api/agent-identities/{id}/resolve`, at spawn.
// The renderer passes an ID and main fetches the content — never a renderer snapshot — so the prompt
// text is fresh, trusted and filtered by the operator's knowledge visibility.
// Rides `api.js › apiFetch` (cookie-authed, the shared 401 repair); never a raw fetch.

const { apiFetch } = require('./api');
const { diag } = require('./diag');

// Short: a button click waits on it, and the `busy` refusal already reads as "try again".
const IDENTITY_RESOLVE_TIMEOUT_MS = 5000;

// The boundary's own bounds, each the server's number — never smaller (F-287): a lower bound is a
// limit the operator can neither see nor satisfy. `schema-sql.test.ts` pins the `MAX_*` literals.
const MAX_INSTRUCTIONS = 32768; // the column's own CHECK
const MAX_FIELDS = 50; // MAX_FIELD_COUNT
const MAX_BASES = 50;
const MAX_SCOPES = 200; // `schema.ts › MAX_KNOWLEDGE_SCOPES` (scopes, not bases)
const MAX_SCOPE_PATH = 500; // a `/`-joined path of several server-bounded segments
const MAX_BASE_SLUG = 80; // `knowledge/schema.ts` — the slug column's own max
const MAX_CARD_SUMMARY = 300; // `@/config › DESCRIPTION_MAX`, the bound the card is SENT at
const MAX_FOLDER_NAME = 200; // `knowledge/schema.ts › KnowledgeFolder.name`
const MAX_CARD_FOLDERS = 50; // `service-knowledge-scopes.ts › MAX_CARD_FOLDERS`
// Must stay well above `MAX_CARD_FOLDERS`, or clamping would fake the renderer's completeness check.
const MAX_FOLDER_COUNT = 10000;

const MAX_NAME = 120; // `schema.ts › NameSchema` / `agent_identities_name_charset_check`
const MAX_FIELD_KEY = 80; // `schema.ts › IdentityFieldSchema.key`
const MAX_FIELD_VALUE = 1000; // …and its `.value`
const MAX_MODEL = 120; // `schema.ts › MAX_MODEL_CHARS`; the launch funnel resolves or refuses the id
const MAX_BASE_LABEL = 200; // a base id or slug and its display name — neither reaches a prompt
                            // line unsanitized (`prompt-framing-agent-identity.js › knowledgeLines`)

// The shared UUID rule, never a local copy (`test/uuid-rule-parity.test.mjs` counts copies).
const { isUuid } = require('./ipc-guards');
const { RUNTIME_ID_RE } = require('./launch-directive-vocab');

function isIdentityId(value) {
  return isUuid(value);
}

/** Bounded text at the caller's bound (no default — every field has its own server bound). */
function label(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** A card fact: whole or gone, never sliced — half a slug or summary reads like the whole thing. */
function whole(value, max) {
  return typeof value === 'string' && value.length <= max ? value : '';
}

/**
 * The card's top-level folders narrowed to `{name, summary}` (never entries). A dropped malformed
 * row is safe only because the renderer then sees `length !== baseFolderCount` and drops the line.
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

/** The identity's runtime id, or `''` for none. Grammar only — the registry decides at launch. */
function runtimeId(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return RUNTIME_ID_RE.test(v) ? v : '';
}

/** A non-negative integer off the wire; anything garbled is 0 (never a false "knowledge is missing"). */
function count(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), typeof max === 'number' ? max : MAX_BASES);
}

/**
 * Narrow the payload to the keys a launch reads — a literal allowlist, never a spread, so a key the
 * server adds later cannot reach prompt text by accident. Nulls stay null. `knowledge` rides beside
 * `knowledgeBases`; the four card keys ride base scopes only; `unreachableKnowledgeBaseCount` is a count.
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
    runtime: runtimeId(b.runtime),
    fields: fields
      .filter((f) => f && typeof f === 'object')
      .map((f) => ({ key: label(f.key, MAX_FIELD_KEY), value: label(f.value, MAX_FIELD_VALUE) })),
    knowledgeBases: bases
      .filter((k) => k && typeof k === 'object')
      .map((k) => ({ id: label(k.id, MAX_BASE_LABEL), name: label(k.name, MAX_BASE_LABEL) })),
    // An allowlist inside the allowlist. An unknown `scope` fails to `'base'` (the wider call, which
    // cannot point at a document that does not exist); card keys ride base scopes only.
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
    unreachableKnowledgeBaseCount: count(b.unreachableKnowledgeBaseCount),
    // Fails foreign: anything but an explicit `true` gets the stronger security header.
    authoredByCaller: b.authoredByCaller === true,
  };
}

/**
 * Resolve an identity for a spawn. Never throws, and never degrades to a blank agent.
 * @returns {Promise<{ok: true, identity: object} | {ok: false, reason: 'no-identity' | 'busy'}>}
 *   404 (deleted, invisible or elsewhere — one answer, 404-never-403) and an unusable 2xx body are
 *   `no-identity`; timeout, network and every other non-2xx are `busy`. A name-only identity is legal.
 */
async function resolveAgentIdentity(identityId, workspaceId) {
  if (!isIdentityId(identityId)) return { ok: false, reason: 'no-identity' };
  let res;
  try {
    res = await apiFetch(`/api/agent-identities/${identityId}/resolve`, {
      method: 'GET',
      workspaceId: typeof workspaceId === 'string' ? workspaceId : undefined,
      timeoutMs: IDENTITY_RESOLVE_TIMEOUT_MS,
      noStore: true,
    });
  } catch (err) {
    // The timeout's abort and a dead socket are the same "could not ask right now".
    diag('identity-resolve: network', String(identityId).slice(0, 8), (err && err.message) || 'error');
    return { ok: false, reason: 'busy' };
  }
  if (!res) return { ok: false, reason: 'busy' };
  if (res.status === 404) {
    // Deleted, not visible, or elsewhere: one word; this machine must not guess between them.
    diag(
      'identity-resolve: 404',
      String(identityId).slice(0, 8),
      '— deleted, not visible to this operator, or in another container'
    );
    return { ok: false, reason: 'no-identity' };
  }
  if (!res.ok) {
    // Every other non-2xx (4xx included) is `busy`: none of them means the identity is gone.
    diag('identity-resolve: HTTP', res.status, String(identityId).slice(0, 8));
    return { ok: false, reason: 'busy' };
  }
  let body = null;
  try { body = await res.json(); } catch (_err) { body = null; }
  const identity = narrow(body);
  if (!identity.name) {
    diag('identity-resolve: unusable payload', String(identityId).slice(0, 8));
    return { ok: false, reason: 'no-identity' };
  }
  return { ok: true, identity };
}

// The New agent popup's per-launch overrides, re-validated here — main is the only real validator:
// the SPA cannot import the zod-backed charset rule, so it bounds only lengths (F-281). A bad field
// row is dropped, not a refused launch; `prompt-framing-agent-identity.js › fieldLines` re-sanitizes.
const { UNSAFE_LABEL_RE } = require('./session-telemetry');

const MAX_OVERRIDE_KEY = 80; // `schema.ts › IdentityFieldSchema.key`
const MAX_OVERRIDE_VALUE = 1000; // …and its `value`

/** The server's short-label charset (`''` is safe: a half-filled form). */
function isSafeLabel(value) {
  if (typeof value !== 'string') return false;
  UNSAFE_LABEL_RE.lastIndex = 0; // the shared regex carries /g; a stale index answers wrongly
  return !UNSAFE_LABEL_RE.test(value);
}

/**
 * Narrow the renderer's overrides to what may reach a spawn. Absent is the only "no override";
 * `fields` replaces, never merges; `instructions` is prose (the column's bound, no charset rule).
 * The model is bounded, not coerced — the launch funnel resolves it on the live roster or refuses.
 * @returns {{model: string, instructions: string, fields: null | Array<{key: string, value: string}>}}
 *   `''` = "the chain continues".
 */
function narrowOverrides(overrides) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const asked = typeof o.model === 'string' ? o.model.slice(0, MAX_MODEL) : '';
  const instructions = typeof o.instructions === 'string'
    ? o.instructions.slice(0, MAX_INSTRUCTIONS).trim()
    : '';
  const out = { model: require('./runtime/selection-vocabulary').pickOf(asked), instructions, fields: null };
  if (!Array.isArray(o.fields)) return out;
  const kept = [];
  const seen = new Set();
  for (const f of o.fields.slice(0, MAX_FIELDS)) {
    if (!f || typeof f !== 'object') continue;
    const key = typeof f.key === 'string' ? f.key.trim().slice(0, MAX_OVERRIDE_KEY) : '';
    const value = typeof f.value === 'string' ? f.value.trim().slice(0, MAX_OVERRIDE_VALUE) : '';
    // A keyless row names nothing; a duplicate key is what `IdentityFieldsSchema` refuses.
    if (!key || seen.has(key)) continue;
    if (!isSafeLabel(key) || !isSafeLabel(value)) {
      diag('identity-resolve: dropped an override field whose charset the server would refuse');
      continue;
    }
    seen.add(key);
    kept.push({ key, value });
  }
  out.fields = kept;
  return out;
}

/**
 * The identity this spawn runs as: the resolved row with the popup's fields/instructions substituted.
 * Never sets the model (the precedence chain in `session-launch-op.js` owns it). Applied after the
 * approval gate, so a foreign identity's approval shows the text the operator did not write, and
 * `authoredByCaller` stays the server's. A blank launch with typed instructions becomes an
 * instructions-only identity (F-695).
 */
function applyOverrides(identity, narrowed) {
  const instructions = (narrowed && narrowed.instructions) || '';
  if (!identity) {
    return instructions
      ? { name: null, instructions, authoredByCaller: true, instructionsOnly: true, fields: null }
      : null;
  }
  const fields = narrowed && narrowed.fields;
  const next = fields ? { ...identity, fields } : identity;
  return instructions ? { ...next, instructions } : next;
}

module.exports = {
  resolveAgentIdentity,
  isIdentityId,
  narrow,
  narrowOverrides,
  applyOverrides,
  IDENTITY_RESOLVE_TIMEOUT_MS,
};
