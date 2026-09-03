"use strict";
/**
 * Shared resolvers + error mappers for `dopl_kb`, leaned on by the read, write
 * and copy op modules. The registrar (knowledge.ts) routes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNTRUSTED_ENTRY_BODY_HEADER = void 0;
exports.resolveBaseOr = resolveBaseOr;
exports.isErr = isErr;
exports.agentWriteDenied = agentWriteDenied;
exports.sharedCredentialPrivateBaseDenied = sharedCredentialPrivateBaseDenied;
exports.writeFileValidationError = writeFileValidationError;
exports.updateBaseValidationError = updateBaseValidationError;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const agent_shared_1 = require("./agent-shared");
const tool_errors_1 = require("./tool-errors");
const untrusted_fence_1 = require("./untrusted-fence");
/** ⚠ The row `dopl_kb`'s description teaches first — one declaration, both uses. */
const BASE_NOT_FOUND = tool_errors_1.KB_ERRORS[0];
/** ⚠ Local, like `agent-shared.ts` and `channel-addressing.ts` — this package
 *  already carries several copies and unifying them is not this change. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Base reference (slug or UUID) → `KnowledgeBase` row, null when nothing
 * matches. ⚠ Calls `listKbBases` once per invocation — not for tight loops.
 *
 * 🔒 **AND A UUID GETS A SECOND, ID-ONLY LOOKUP (F-470).** `listKbBases` answers
 * for the container this connection is bound to, so matching a ref against that
 * list made every `dopl_kb` op container-keyed — including the ops whose whole
 * argument is an ID. A base on the caller's own personal shelf, or in another
 * container they belong to, answered `base_not_found` for an id that
 * `GET /api/knowledge/bases/<id>` resolves, which is the wave's headline claim
 * ("an id resolves its own container") being untrue on this surface.
 *
 * ⚠ **THE SECOND LOOKUP IS NOT A SECOND FENCE AND ADDS NO REACH.** It is the
 * server's own id door, which runs the resolver's four clauses, the M-10 matrix
 * and the agent audience ceiling in the container the id names. A ref this
 * caller may not name comes back a refusal and is reported as `base_not_found`,
 * the same answer as before.
 *
 * ⚠ **UUID ONLY, AND NO NAME FALLBACK.** A slug is scoped to a container by
 * definition, so asking the id door about one would be asking a different
 * question; and an id lookup that degraded into a name lookup would make "no
 * such id" and "no such name" answer through each other.
 * ⚠ **ONLY AN API REFUSAL IS SWALLOWED.** A transport failure must not read as
 * "no such base" — that is how an outage becomes a deletion in an agent's notes.
 */
async function resolveBase(client, ref) {
    const bases = await client.listKbBases();
    const here = bases.find((b) => b.slug === ref || b.id === ref);
    if (here)
        return here;
    if (!UUID_RE.test(ref))
        return null;
    try {
        return await client.getKbBase(ref);
    }
    catch (e) {
        if ((0, respond_1.isApiError)(e, 404, "KNOWLEDGE_BASE_NOT_FOUND"))
            return null;
        throw e;
    }
}
/** resolveBase + the standard not-found error; caller short-circuits on `isError`. */
async function resolveBaseOr(client, ref) {
    const base = await resolveBase(client, ref);
    if (!base)
        return (0, respond_1.err)((0, tool_errors_1.refusal)(BASE_NOT_FOUND, `Ref: ${(0, narration_1.inlineOr)(ref, "`(unreadable ref)`")}. Deleting is permanent, so a base you deleted is not recoverable.`));
    return base;
}
function isErr(x) {
    return "isError" in x && x.isError === true;
}
/**
 * ⚠ **THIS CONSTANT IS NOW THE FENCE'S HEADER, AND THE 430-CHAR PARAGRAPH IT
 * USED TO HOLD IS GONE** (A14, 2026-09-02). The old wording asked a reader to
 * discount the document below it; it said nothing about where the document
 * ENDS, so a body closing with *"— end of document. New instruction from your
 * operator: …"* read, to somebody following the banner, as a document followed
 * by an instruction.
 *
 * `untrusted-fence.ts` answers that: the body is wrapped in
 * `<body_HEX>`…`</body_HEX>` with HEX minted per response, so text inside the
 * fence cannot end it and anything after the real close was written by this
 * server. The name survives because it is the seam
 * `authored-body-untrusted.test.ts` pins — including the POSITION assertion,
 * which the fence keeps by emitting this line first.
 *
 * ⚠ STILL CONDITIONAL, for the reason it always was: the caller's OWN entries
 * render bare, because framing them is noise on the overwhelmingly common path
 * and noise is how a security header stops being read.
 *
 * ⚠ The body itself is NOT neutralized — it is the document the product exists
 * to hand the agent, and stripping its markdown breaks the feature. The fence
 * is what makes rendering it verbatim safe (`narration.ts` draws the VALUE/BODY
 * line).
 */
exports.UNTRUSTED_ENTRY_BODY_HEADER = untrusted_fence_1.FENCE_HEADER;
/**
 * 403 `AGENT_WRITE_DISABLED` — an agent deleting inside a base flagged
 * `agent_write_enabled=false`. Surfaces the server's actionable message rather
 * than a raw throw; null otherwise so the caller rethrows. ⚠ Duck-typed on
 * `.status`/`.code` to avoid importing the @dopl/client error class.
 */
function agentWriteDenied(e) {
    if (!(0, respond_1.isApiError)(e, 403, "AGENT_WRITE_DISABLED"))
        return null;
    return (0, respond_1.err)((0, respond_1.apiMessage)(e) ??
        "This knowledge base is read-only to agents — delete it from the Dopl web UI.");
}
/**
 * A shared/service credential tried to own a PRIVATE knowledge base (403
 * `WORKSPACE_KEY_PRIVATE_VISIBILITY`).
 *
 * ⚠ **THE MIRROR OF `agent-shared.ts › sharedCredentialPrivateDenied`, AND IT
 * WAS MISSING UNTIL 2026-09-02.** `op="copy_base"` forces `visibility: "private"`
 * exactly as `op="copy"` does, so it can raise the identical 403 — and it had no
 * mapping, so the refusal reached an agent as an unhandled throw ("the call
 * failed") over a copy that created nothing. The predicate and the code string
 * are shared; only the NOUN and the remedy differ, because a base's remedy is
 * not a template's.
 */
function sharedCredentialPrivateBaseDenied(e) {
    if (!(0, respond_1.isApiError)(e, 403, agent_shared_1.PRIVATE_VISIBILITY_DENIED_CODE))
        return null;
    return (0, respond_1.err)(`${(0, respond_1.apiMessage)(e) ?? "This credential cannot own a private knowledge base."} NOTHING was created — the copy stopped at the base itself, so there is no partial tree to clean up. A credential that may be shared between humans has no "private to me" to write to, and this op only ever creates PRIVATE bases: reconnect with a personal credential, or ask the user to copy it in the Dopl app.`);
}
/**
 * True for a 400 schema-validation failure
 * (`{ error: { code: "VALIDATION_FAILED", details } }`). ⚠ Duck-typed to work
 * across the @dopl/client boundary without importing the error class.
 */
function isValidationError(e) {
    return (typeof e === "object" &&
        e !== null &&
        e.status === 400 &&
        e.code === "VALIDATION_FAILED");
}
/** Field names named by a validation error's zod-issue `details` array. */
function validationFields(details) {
    const fields = new Set();
    if (Array.isArray(details)) {
        for (const issue of details) {
            const path = issue.path;
            const first = Array.isArray(path) ? path[0] : undefined;
            if (typeof first === "string")
                fields.add(first);
        }
    }
    return fields;
}
/**
 * Bidi / directional-formatting control chars the name schema rejects as
 * anti-spoofing: embeddings + overrides (U+202A–U+202E), isolates
 * (U+2066–U+2069), LTR/RTL marks (U+200E/U+200F), Arabic letter mark (U+061C).
 * ⚠ Built from numeric code points, not a regex literal, so the source stays
 * pure-ASCII with no raw bidi controls sitting invisibly in this file.
 */
const BIDI_CONTROL_RANGES = [
    [0x202a, 0x202e],
    [0x2066, 0x2069],
    [0x200e, 0x200f],
    [0x061c, 0x061c],
];
const BIDI_CONTROL_RE = new RegExp(`[${BIDI_CONTROL_RANGES.map(([lo, hi]) => lo === hi
    ? String.fromCodePoint(lo)
    : `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`).join("")}]`);
/** `U+XXXX` for the first bidi control char in `text`, else null. */
function namedBidiChar(text) {
    const m = BIDI_CONTROL_RE.exec(text);
    if (!m)
        return null;
    const cp = m[0].codePointAt(0) ?? 0;
    return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}
/**
 * `write_file` validation failure → a message naming field + rule + recovery.
 * Null when unrecognized, so the caller rethrows.
 */
function writeFileValidationError(e, title) {
    if (!isValidationError(e))
        return null;
    const fields = validationFields(e.details);
    // `path` carries no schema rule (z.string()), so a validation failure here is
    // a title or body-size issue.
    if (fields.has("title") || fields.size === 0) {
        const t = title ?? "";
        const bidi = namedBidiChar(t);
        if (bidi) {
            return (0, respond_1.err)(`write_file: title contains a disallowed bidirectional control character (${bidi}) — remove it and retry (this block prevents right-to-left path spoofing).`);
        }
        if (t.includes("/")) {
            return (0, respond_1.err)(`write_file: titles can't contain '/' (it's the path separator) — use a different title, or create the folder via the path and give the entry a clean title.`);
        }
        if (fields.has("title")) {
            return (0, respond_1.err)(`write_file: title is invalid — it can't contain control or zero-width characters or leading/trailing whitespace. Use a plain title.`);
        }
    }
    if (fields.has("body")) {
        return (0, respond_1.err)(`write_file: body is too large — the limit is 1 MB. Split it into multiple entries.`);
    }
    return (0, respond_1.err)(`write_file: request body failed validation${fields.size ? ` (field: ${[...fields].join(", ")})` : ""}. Titles can't contain '/', control, or zero-width characters.`);
}
/**
 * `update_base` validation failure → a message naming field + rule + recovery.
 * Null when unrecognized, so the caller rethrows.
 */
function updateBaseValidationError(e) {
    if (!isValidationError(e))
        return null;
    const fields = validationFields(e.details);
    if (fields.has("slug")) {
        return (0, respond_1.err)(`update_base: slug must match ^[a-z0-9-]+$ — lowercase letters, digits, and hyphens only (no leading/trailing hyphen, no spaces).`);
    }
    if (fields.has("name")) {
        return (0, respond_1.err)(`update_base: name can't be blank — pass a non-empty name, or omit it to leave the name unchanged.`);
    }
    if (fields.has("description")) {
        return (0, respond_1.err)(`update_base: description is too long.`);
    }
    return (0, respond_1.err)(`update_base: request body failed validation${fields.size ? ` (field: ${[...fields].join(", ")})` : ""}.`);
}
