"use strict";
/**
 * The ontology's FIELD rules on the MCP side — kinds, the one-string values'
 * checks, a field's description and a select's options (2026-10-01).
 *
 * ⚠ HAND-MIRRORED from `src/features/ontology/field-kinds.ts` + `schema.ts`
 * (this tree cannot import `src/`). The server is the fence — every write still
 * parses through `OntologyObjectUpdateSchema` — so this copy exists to fail at
 * the tool boundary with a field-named message instead of an opaque
 * downstream VALIDATION_FAILED. Change both together.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD_DESCRIPTION_MAX = exports.LINK_VALUE_MAX = exports.ENUM_OPTIONS_MAX = exports.ENUM_OPTION_MAX = exports.PILL_VALUE_MAX = exports.TEXT_VALUE_MAX = exports.FIELD_KINDS = void 0;
exports.isStringKind = isStringKind;
exports.isIsoDate = isIsoDate;
exports.isHttpUrl = isHttpUrl;
exports.cleanOptions = cleanOptions;
exports.optionsProblem = optionsProblem;
exports.nextDescription = nextDescription;
exports.templateFieldFor = templateFieldFor;
exports.stringValue = stringValue;
exports.upsertTemplateField = upsertTemplateField;
exports.kindNote = kindNote;
exports.linkSpan = linkSpan;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
exports.FIELD_KINDS = [
    "text",
    "pill",
    "enum",
    "date",
    "link",
    "ref",
    "knowledge",
    "skill",
];
exports.TEXT_VALUE_MAX = 4000;
exports.PILL_VALUE_MAX = 400;
exports.ENUM_OPTION_MAX = 200;
exports.ENUM_OPTIONS_MAX = 50;
exports.LINK_VALUE_MAX = 2000;
exports.FIELD_DESCRIPTION_MAX = 1000;
function isStringKind(kind) {
    return (kind === "text" || kind === "pill" || kind === "enum" || kind === "date" || kind === "link");
}
function isIsoDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m)
        return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    return (date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d);
}
function isHttpUrl(value) {
    if (value.length > exports.LINK_VALUE_MAX)
        return false;
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
    }
    catch {
        return false;
    }
}
/** Trimmed, non-empty, first-spelling-wins (case-insensitive). */
function cleanOptions(options) {
    const out = [];
    for (const raw of options) {
        const option = raw.trim();
        if (!option || out.some((o) => o.toLowerCase() === option.toLowerCase()))
            continue;
        out.push(option);
    }
    return out;
}
/** Caps the server would 400 on, named. `null` = fine. */
function optionsProblem(options) {
    if (options.length > exports.ENUM_OPTIONS_MAX) {
        return `A select field takes at most ${exports.ENUM_OPTIONS_MAX} options; got ${options.length}.`;
    }
    const long = options.find((o) => o.length > exports.ENUM_OPTION_MAX);
    return long ? `Option ${(0, narration_1.inlineOr)(long, narration_1.NO_NAME)} is over ${exports.ENUM_OPTION_MAX} characters.` : null;
}
/** A field description: trimmed, `""` clears. `undefined` = keep the stored one. */
function nextDescription(given, stored) {
    if (given === undefined)
        return stored ? { description: stored } : {};
    const description = given.trim();
    if (description.length > exports.FIELD_DESCRIPTION_MAX) {
        return { fail: (0, respond_1.err)(`A field description is at most ${exports.FIELD_DESCRIPTION_MAX} characters.`) };
    }
    return description ? { description } : {};
}
/**
 * The template field a card's attribute was born from: same label on a
 * container that holds the card. A select field's options are the TEMPLATE's
 * when one exists (the panel reads them the same way).
 */
function templateFieldFor(snapshot, object, label) {
    const needle = label.toLowerCase();
    for (const o of Object.values(snapshot.objects)) {
        if (!o.childIds.includes(object.id))
            continue;
        const field = (o.template ?? []).find((f) => f.label.toLowerCase() === needle);
        if (field)
            return field;
    }
    return undefined;
}
/**
 * One string value for `kind`, checked: the select's choice (matched
 * case-insensitively, stored as the option's own spelling), a day, a link.
 * `""` clears every kind.
 */
function stringValue(kind, raw, label, options) {
    const name = (0, narration_1.inlineOr)(label, narration_1.NO_NAME);
    const cap = kind === "text" ? exports.TEXT_VALUE_MAX : kind === "pill" ? exports.PILL_VALUE_MAX : exports.LINK_VALUE_MAX;
    if (raw.length > cap) {
        return {
            fail: (0, respond_1.err)(`set_attribute kind="${kind}" value for ${name} is ${raw.length} characters; the max is ${cap}. Shorten it, use kind="text" for longer prose, or link a knowledge entry instead.`),
        };
    }
    if (kind === "text" || kind === "pill")
        return { value: raw };
    const v = raw.trim();
    if (v === "")
        return { value: "" };
    if (kind === "enum") {
        const hit = options.find((o) => o.toLowerCase() === v.toLowerCase());
        if (hit)
            return { value: hit };
        const list = options.map((o) => (0, narration_1.inlineOr)(o, narration_1.NO_NAME)).join(", ") || "none — pass `options`";
        return { fail: (0, respond_1.err)(`${(0, narration_1.inlineOr)(v, narration_1.NO_NAME)} is not an option of ${name}. Options: ${list}.`) };
    }
    if (kind === "date") {
        // A full ISO timestamp is accepted and kept as its calendar day.
        const day = /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : v;
        if (isIsoDate(day))
            return { value: day };
        return { fail: (0, respond_1.err)(`${name} is a date: send YYYY-MM-DD (got ${(0, narration_1.inlineOr)(v, narration_1.NO_NAME)}).`) };
    }
    if (isHttpUrl(v))
        return { value: v };
    return { fail: (0, respond_1.err)(`${name} is a link: send an absolute http(s) URL (got ${(0, narration_1.inlineOr)(v, narration_1.NO_NAME)}).`) };
}
/**
 * `set_template_field` as a pure upsert by label. ⚠ An omitted `kind`,
 * `description` or `options` KEEPS the stored one — an agent adding a
 * description must not reset a select to text.
 */
function upsertTemplateField(template, args) {
    const label = (args.label ?? "").trim();
    if (!label)
        return { fail: (0, respond_1.err)("set_template_field needs a non-empty `label`.") };
    const needle = label.toLowerCase();
    const existing = template.find((f) => f.label.toLowerCase() === needle);
    const kind = args.kind ?? existing?.kind ?? "text";
    if (args.options !== undefined && kind !== "enum") {
        return { fail: (0, respond_1.err)('`options` apply only to kind="enum".') };
    }
    const described = nextDescription(args.description, existing?.description);
    if ("fail" in described)
        return described;
    const options = kind === "enum" ? cleanOptions(args.options ?? existing?.options ?? []) : undefined;
    const bad = options && optionsProblem(options);
    if (bad)
        return { fail: (0, respond_1.err)(bad) };
    const field = {
        key: existing?.key ?? needle.replace(/\s+/g, "-"),
        label,
        kind,
        ...described,
        ...(options ? { options } : {}),
    };
    return {
        field,
        template: existing
            ? template.map((f) => (f === existing ? field : f))
            : [...template, field],
    };
}
/** `(enum: `A`, `B`)` / `(date)` / `` — the kind note a field line carries.
 *  Text and tag say nothing, which is what every line said before kinds grew. */
function kindNote(kind, options) {
    if (kind === "enum") {
        const list = (options ?? []).map((o) => (0, narration_1.inlineOr)(o, narration_1.NO_NAME)).join(", ");
        return ` (enum: ${list || "no options"})`;
    }
    return kind === "date" || kind === "link" ? ` (${kind})` : "";
}
/** A link value inline: a code span with backticks percent-encoded, so `#`,
 *  `_` and `[` survive (the neutralizer would strip them out of the URL). */
function linkSpan(url) {
    return `\`${url.replace(/[\u0000-\u001F\u007F\s]/g, "").replace(/`/g, "%60")}\``;
}
