"use strict";
/**
 * status-footer.ts — the `_dopl_status` footer and the wrapper that puts it on
 * a meta-tool's response. ⚠ Both registration helpers in `registrar.ts` end
 * here; that is what makes the footer uniform.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestedFormat = requestedFormat;
exports.appendDoplStatus = appendDoplStatus;
exports.withDoplStatus = withDoplStatus;
const identity_js_1 = require("./tools/identity.js");
const narration_js_1 = require("./tools/narration.js");
const response_size_js_1 = require("./tools/response-size.js");
const instructions_js_1 = require("./instructions.js");
/**
 * 🔒 **THE `response_format` A CALL ASKED FOR, READ OFF THE RAW ARGS** (S37/S54,
 * 2026-09-18).
 *
 * ⚠ **THE KNOB IS APPLIED IN THE RENDERERS AND THE FOOTER IS APPENDED AFTER
 * THEM** (`response-size.ts`'s header states the first half), so the footer was
 * the one part of a response the knob could never reach — and it is pure
 * metadata, which is exactly what `concise` promises to drop. A promise a
 * surface visibly does not keep is worse than no knob: an agent that catches one
 * stops spending the other.
 *
 * ⚠ **DUCK-TYPED, LIKE {@link Gates.requestedOp} BESIDE IT.** Arguments arrive
 * off an MCP wire as unvalidated JSON and each tool declares the field for
 * itself; a value that is not the literal `"concise"` reads as the default, so a
 * tool that does not publish the knob cannot be given one by a caller.
 */
function requestedFormat(args) {
    const value = args?.response_format;
    return value === "concise" || value === "detailed" ? value : undefined;
}
/**
 * Append the mandatory `_dopl_status` footer. ⚠ Reports the EFFECTIVE workspace
 * this call HIT plus a source label (`per-call arg` / `header pin`), and any
 * per-call `note` the registrar wants the agent to see.
 *
 * ⚠ **THE CALLER LINE IS UNCONDITIONAL SINCE B13, AND THE OLD EARLY RETURN WAS
 * THE BUG WAITING TO HAPPEN.** It used to skip the whole footer when there was
 * no effective workspace — harmless while every connection auto-targeted one,
 * and a silent deletion of `caller: id=…` from every response the moment the
 * auto-target went. The server instructions tell every agent that footer opens
 * with its own user id; a workspace it has not got must not take the identity
 * with it.
 *
 * Skipped only when the handler returned `isError` — don't muddy error messages.
 *
 * 🔒 **AND SINCE 2026-09-18, `response_format="concise"` DROPS IT** (S37/S54).
 * `RESPONSE_FORMAT_FIELD` promises the knob *"drops METADATA — timestamps, ids,
 * scope notes, legends"*, and this footer is nothing but those three: who the
 * caller is, which container the call hit, and how that container was chosen.
 * It rode every successful response whatever the caller asked for, which made it
 * the one place the published promise was untrue.
 *
 * ⚠ **THE `note` IS NOT METADATA AND SURVIVES.** It is a fact about what THIS
 * call just did that nothing else reports — a `workspace=` argument that was
 * dropped (`workspace-arg.ts › deprecatedAliasNote`, whose whole value is that
 * *the ignore is REPORTED, not swallowed*) or a call that went unmetered. A
 * concise response therefore carries a one-line footer when there is something
 * to say and none at all when there is not, which is the smallest honest answer.
 *
 * ⚠ **THE CALLER LINE IS STILL UNCONDITIONAL IN THE OTHER DIRECTION** — see the
 * B13 note above. That rule is about a MISSING WORKSPACE silently deleting the
 * identity line; this is a caller explicitly asking for less. The two are not
 * the same event and only one of them is the agent's own choice.
 *
 * 🔒 **AND IT SAYS WHETHER THE BINDING MOVED, NOT ONLY WHERE THIS CALL LANDED**
 * (S29b, 2026-09-18). `container=` routes ONE call through an AsyncLocalStorage
 * override (`registrar.ts`) and changes nothing about the connection, so
 * `active_workspace` legitimately reads differently on two consecutive calls —
 * and an agent watching that line flip has no way to tell a per-call detour from
 * a session that re-bound underneath it. It then addresses the next call from
 * the wrong premise, which is exactly the hunting this surface exists to remove.
 * {@link bindingLine} states it: the override is marked THIS CALL ONLY and the
 * connection's own container is named beside it.
 */
async function appendDoplStatus(response, effective, caller, note, format, 
/**
 * ⚠ **THE CONNECTION'S OWN CONTAINER, WHICH IS NOT ALWAYS `effective`** — the
 * registrar's addressed branch passes the per-call override as `effective` and
 * this as the session binding it did NOT change. Omitted means "the same
 * thing", which is what every caller that cannot be addressed away means.
 */
binding) {
    const res = response;
    if (res.isError)
        return res;
    if ((0, response_size_js_1.isConcise)(format))
        return note ? appendFooter(res, `\n\n_${note}_`) : res;
    // ⚠ Name goes through the neutralizer: this footer is the agent's targeting
    // check, so it is the line worth forging, and a name is bounded only by
    // length (see UNTRUSTED_DIRECTORY_NOTE) — one newline buys a second, invented
    // `_dopl_status` key. The slug (kebab-regex) and id (server-issued) beside it
    // are the halves an owner cannot type.
    //
    // ⚠ WHO comes before WHERE: this is the one line riding every successful
    // response, and the instructions tell the agent to read it, so the immutable
    // id must be here rather than hunted for across surfaces that disagree.
    const footer = [
        "",
        "",
        "---",
        "_dopl_status:",
        (0, identity_js_1.callerStatusLine)(caller),
        // ⚠ An UNBOUND connection names no container rather than guessing one; the
        // server resolves the caller's own when nothing is passed (B10).
        ...(effective
            ? [
                // ⚠ **`kind=` SINCE R-32.** This is the one line on every successful
                // response, and it is where a single-container list says what kind of
                // container it listed — the alternative was a kind column on every
                // row of every list, paid for per row.
                `  active_workspace: ${(0, narration_js_1.inlineOr)(effective.name, instructions_js_1.UNNAMED_WORKSPACE)} (slug=\`${effective.slug}\`, id=\`${effective.id}\`, role=${effective.role}${effective.kind ? `, kind=\`${effective.kind}\`` : ""})`,
                `  workspace_source: ${bindingLine(effective, binding)}`,
            ]
            : []),
        ...(note ? [`  ${note}`] : []),
    ].join("\n");
    return appendFooter(res, footer);
}
/**
 * 🔒 **THE SOURCE, PLUS WHETHER THE CONNECTION MOVED WITH IT** (S29b).
 *
 * ⚠ **THE LABEL ALONE WAS AMBIGUOUS IN THE ONE DIRECTION THAT MATTERS.**
 * `per-call arg` said who chose the target and said nothing about how long the
 * choice lasts, so the honest reading ("for this call") and the costly one ("the
 * session is there now") were the same six characters.
 *
 * ⚠ **THE UNCHANGED CASES STAY BYTE-IDENTICAL.** A `header pin` IS the binding,
 * and a `per-call arg` naming the container the connection was already on moved
 * nothing — neither gets a clause, so the common footer does not grow.
 *
 * ⚠ **AN UNBOUND CONNECTION IS NAMED AS UNBOUND, NEVER LEFT BLANK.** "no
 * container" is the answer B13 made ordinary, and an agent that reads nothing
 * there will assume the override stuck.
 */
function bindingLine(effective, binding) {
    if (effective.source !== "per-call arg")
        return effective.source;
    if (binding === undefined || binding?.id === effective.id)
        return effective.source;
    const connection = binding
        ? `\`${binding.slug}\` (id=\`${binding.id}\`)`
        : "no container";
    return `${effective.source} — THIS CALL ONLY; the connection is still on ${connection}`;
}
/** Append to the final text block; add a new one if there is no text content.
 *  ⚠ Shared by the full footer and by `concise`'s note-only line, so the two
 *  cannot drift in how they attach to a response. */
function appendFooter(res, footer) {
    const content = [...res.content];
    const lastIdx = content.length - 1;
    if (lastIdx >= 0 && content[lastIdx]?.type === "text") {
        content[lastIdx] = {
            type: "text",
            text: `${content[lastIdx].text}${footer}`,
        };
    }
    else {
        content.push({ type: "text", text: footer.trimStart() });
    }
    return { ...res, content };
}
/**
 * Wrap a meta-tool handler so every successful response ends with the
 * `_dopl_status` footer reporting the connection's container (if any).
 */
function withDoplStatus(handler, getEffective, caller, 
/** ⚠ READ **AFTER** THE HANDLER, never before — the note it returns is a fact
 *  about what the call just did (today: whether it went unmetered,
 *  `credits-unmetered.ts › unmeteredNote`). Omitted means "no note", which is
 *  what every meta tool answered before 2026-09-14. */
getNote) {
    return async (args) => {
        const result = await handler(args);
        return appendDoplStatus(result, getEffective(), caller, getNote?.() ?? null, 
        // ⚠ READ OFF THE CALL'S OWN ARGS, not off a wrapper state: the meta path
        // registers straight onto the SDK server, so this is the only place the
        // request's `response_format` is still in hand.
        requestedFormat(args));
    };
}
