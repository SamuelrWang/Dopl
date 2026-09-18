"use strict";
/**
 * container-resolve.ts — 🔒 **HOW ONE TOOL CALL FINDS ITS CONTAINER** (R-32,
 * Samuel 2026-09-17). The registrar is the mechanism and `workspace-arg.ts` is
 * the policy table; this file is the DECISION, in one place, so the three
 * outcomes a call can have — addressed, unaddressed, refused — are enumerated
 * once rather than spelled out inside a wrapper that also charges credits and
 * appends a footer.
 *
 * ── THE ADDRESS GRAMMAR ────────────────────────────────────────────────────
 *
 *   container=home        → the CALLER's own personal container, per caller
 *   container=<slug>      → a workspace, or a home channel (its channel's slug;
 *                           one channel per link container, minted from the
 *                           same name — `home/server/service-writes.ts ›
 *                           createHomeChannel`)
 *   container=<id>        → any container the caller is an active member of
 *   workspace=<…>         → DEPRECATED alias, same resolver, one release
 *   (omitted)             → the connection's container, else `home`
 *
 * ⚠ **THE LAST LINE IS THE RULING'S POINT AND IT IS STRUCTURE, NOT COPY.** An
 * unaddressed READ resolves to the caller's own container because the SERVER
 * resolves it (B10), not because a prompt told an agent to pass something. An
 * unaddressed MINT is REFUSED — see `workspace-arg.ts ›
 * UNADDRESSED_WRITE_REFUSALS`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCallAddress = resolveCallAddress;
const narration_js_1 = require("./tools/narration.js");
const workspace_arg_js_1 = require("./workspace-arg.js");
const tool_errors_js_1 = require("./tools/tool-errors.js");
const workspace_directory_js_1 = require("./workspace-directory.js");
/** How many candidates the ambiguity refusal spells out before it summarises
 *  the rest. ⚠ A cap, not a page — `knowledge-shared.ts › MAX_LISTED_MATCHES`
 *  carries the argument, and this is the same number for the same reason. */
const MAX_LISTED_MATCHES = 10;
function err(text) {
    return { isError: true, content: [{ type: "text", text }] };
}
/**
 * Resolve one call's container.
 *
 * ⚠ **`container=` WINS OVER `workspace=` AND BOTH DROPS ARE ANNOUNCED.** A
 * caller that sent two addresses, or sent one on an op that takes none, is told
 * which one the call used — the whole difference between a deprecation window
 * and a silent re-target (B13's argument, one argument later).
 */
async function resolveCallAddress(tool, op, args, { directory, activeWorkspace }) {
    const usedAlias = args.container === undefined && args.workspace !== undefined;
    const ref = usedAlias ? args.workspace : args.container;
    const argName = usedAlias ? "workspace" : "container";
    const bothSent = args.container !== undefined && args.workspace !== undefined;
    if (!(0, workspace_arg_js_1.acceptsWorkspaceArg)(tool, op)) {
        // ⚠ NO HONOURED ADDRESS. The call runs in this connection's container, and
        // when the connection names none the SERVER resolves the caller's own.
        return {
            kind: "unaddressed",
            note: ref === undefined
                ? null
                : (0, workspace_arg_js_1.ignoredWorkspaceNote)(op, typeof ref === "string" ? ref.trim() : "", argName),
        };
    }
    if (ref === undefined) {
        // 🔒 R-32 item 4 — a MINT with no address, on a connection that names no
        // container, would land in the home space. Refuse; do not guess.
        if ((0, workspace_arg_js_1.refusesUnaddressedWrite)(tool, op) && activeWorkspace === null) {
            return { kind: "refusal", response: err((0, workspace_arg_js_1.unaddressedWriteRefusal)(tool, op ?? "")) };
        }
        return { kind: "unaddressed", note: null };
    }
    // ⚠ "provided but blank" (fail closed) must stay distinct from "not
    // provided". A falsy-string test lets a computed-but-empty ref route a write
    // to a container the caller never named.
    const supplied = typeof ref === "string" ? ref.trim() : "";
    if (!supplied) {
        return {
            kind: "refusal",
            response: err(`The \`${argName}\` argument was blank. Pass a container slug or id from \`dopl_workspaces\`, or \`home\` for your home space — or omit it entirely to use this connection's container.`),
        };
    }
    let resolved;
    try {
        // ⚠ Can throw on network/auth failure — an uncaught throw surfaces as an
        // opaque MCP framework error.
        resolved = await directory.resolveContainerRef(supplied);
    }
    catch (e) {
        return {
            kind: "refusal",
            response: err(`Couldn't validate the \`${argName}\` argument (${(0, narration_js_1.inlineOr)(e instanceof Error ? e.message : String(e), "`no detail reported`")}). Try again, or call without \`${argName}=\`.`),
        };
    }
    if (!resolved) {
        return {
            kind: "refusal",
            // ⚠ Caller's own arg, but a raw backtick still escapes this span and puts
            // the tail into narration.
            response: err(`Container not found: ${(0, narration_js_1.inlineOr)(supplied, "`(unreadable ref)`")}. Call \`dopl_workspaces\` for every container you can reach — workspaces, home channels and your home space alike; \`home\` names the last of those.`),
        };
    }
    if ((0, workspace_directory_js_1.isAmbiguousContainer)(resolved)) {
        return {
            kind: "refusal",
            response: err(ambiguousContainer(argName, supplied, resolved.ambiguous)),
        };
    }
    return {
        kind: "addressed",
        effective: {
            id: resolved.id,
            slug: resolved.slug,
            name: resolved.name,
            role: resolved.role,
            kind: (0, workspace_directory_js_1.containerKind)(resolved),
            source: "per-call arg",
        },
        note: bothSent ? (0, workspace_arg_js_1.aliasIgnoredNote)() : usedAlias ? (0, workspace_arg_js_1.deprecatedAliasNote)() : null,
    };
}
/**
 * THE AMBIGUITY REFUSAL — **it lists, and it does not pick** (F-719).
 *
 * ⚠ **IT IS `knowledge-shared.ts › ambiguousBase`'s CONTRACT, ONE TABLE OVER, AND
 * DELIBERATELY NOT A SECOND IDIOM**: the same `reason=ambiguous_slug` literal, the
 * same opening, the same one-line-per-candidate list keyed by the ID to re-issue
 * with — so an agent that learned the remedy from `dopl_kb` applies it unchanged.
 *
 * ⚠ **THE LIST IS THE WHOLE VALUE.** "That slug is ambiguous" alone sends the caller
 * to `dopl_workspaces` for ids it was already holding; each row carries the id and
 * the KIND, which is what says "one of these is a room somebody else named".
 * ⚠ **AND IT IS NOT AN ORACLE** — every row came back from this caller's own
 * lock-narrowed directory, so it discloses exactly what `dopl_workspaces` would.
 */
function ambiguousContainer(argName, ref, matches) {
    const shown = matches.slice(0, MAX_LISTED_MATCHES);
    const rest = matches.length - shown.length;
    return [
        (0, tool_errors_js_1.refusal)(tool_errors_js_1.AMBIGUOUS_CONTAINER, `Nothing ran — ${(0, narration_js_1.inlineOr)(ref, "`(unreadable ref)`")} names ${matches.length} containers you are in, and this call refuses rather than picking one. A slug is unique only WITHIN an account, and a home channel is named by the peer who minted it, so this is a legitimate state. Re-issue with \`${argName}=<id>\` — an id is unique and resolves its own container.`),
        "",
        // ⚠ The id IS the `container=` handle, so the line an agent reads is also
        // the line it can act on.
        ...shown.map((w) => `- \`${w.id}\` — ${(0, narration_js_1.inlineOr)(w.name, "`(unnamed)`")} · kind=\`${(0, workspace_directory_js_1.containerKind)(w)}\``),
        ...(rest > 0 ? [`- …and ${rest} more; \`dopl_workspaces\` has them all.`] : []),
    ].join("\n");
}
