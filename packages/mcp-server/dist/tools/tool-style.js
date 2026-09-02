"use strict";
/**
 * THE HOUSE STYLE — ⚠ **ONE description shape for all thirteen tools, rendered
 * rather than written** (A14, 2026-09-02).
 *
 * ⚠ WHY A RENDERER AND NOT A CONVENTION. Every description on this surface was
 * hand-written prose, and each grew the way honest prose grows: a rule somebody
 * had been bitten by, added where the next agent would read it. Thirteen
 * authors produced thirteen shapes, so a model could not SKIM — it had to read
 * each one whole to find out whether this particular tool happened to mention
 * its limits, its errors, or the sibling it should have called instead. A
 * consistent shape is what lets an agent stop reading early, and the only way
 * to hold a shape across thirteen strings is to generate it.
 *
 * ⚠ THE ORDER IS THE PRODUCT, and it comes from Samuel's production reference
 * (HubSpot / Notion / Slack, 15 tools; the Slack read tools are the model):
 *
 *   1. WHAT IT RETURNS **AND WHAT IT DOES NOT** — one sentence, and it must
 *      land inside {@link HEADLINE_MAX_CHARS}, because a client that truncates
 *      cuts from the end and everything after the cut reached no model at all.
 *   2. THE CAPABILITY CLASS — `Read-only.` or the write policy, said out loud,
 *      so an agent can reason about blast radius without reading further.
 *   3. ROUTING — up to {@link ROUTING_MAX_LINES} `Use <sibling> for <thing>`
 *      lines. A tool suite is a graph; a description that does not encode its
 *      edges makes the model pick tools by name similarity.
 *   4. the tool's OWN body (op bullets, security paragraph, addressing) — the
 *      only part that is still hand-written, because only it is tool-specific.
 *   5. LIMITS, rendered from the zod schema by {@link renderLimits}. One
 *      source: the numbers are the schema's, so a cap cannot be raised in code
 *      and left stale in prose.
 *   6. ERRORS — the top three, `reason=<literal code>` + meaning + retry,
 *      rendered from the tool's own errors table by {@link renderErrors}.
 *   7. EXAMPLES — call shapes as JSON, never prose, inside
 *      {@link EXAMPLES_MAX_CHARS}.
 *
 * ⚠ EVERY RULE ABOVE IS ENFORCED IN `tool-style.test.ts` AND
 * `tool-description-checklist.test.ts`, against the descriptions AS SERVED
 * through a real `listTools()`. A style guide nothing measures is a style
 * nobody holds.
 *
 * ⚠ WHAT THIS FILE DELIBERATELY DOES NOT DO — the anti-patterns of the same
 * reference, pinned by `tool-style.test.ts`: no telemetry parameter billed to
 * the caller's context (HubSpot's `chatInsights`), no regex date validator in a
 * published schema, and no description over {@link HARD_DESCRIPTION_CEILING}.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXAMPLES_MAX_CHARS = exports.ROUTING_MAX_LINES = exports.HARD_DESCRIPTION_CEILING = exports.DESCRIPTION_MAX_CHARS = exports.READ_DESCRIPTION_MAX_CHARS = exports.HEADLINE_MAX_CHARS = void 0;
exports.renderErrors = renderErrors;
exports.renderExamples = renderExamples;
exports.boundsOf = boundsOf;
exports.renderLimits = renderLimits;
exports.composeDescription = composeDescription;
const zod_1 = require("zod");
/**
 * THE HEADLINE WINDOW. ⚠ A property of the CLIENTS, not of this server: the
 * live probe of the same three production servers (2026-09-02) found Notion's
 * search, Notion's fetch and Slack's search all arriving CUT OFF mid-sentence,
 * with everything past the cut invisible at decision time. The first sentence
 * is therefore the only part guaranteed to be read, and it must carry what the
 * tool returns and what it does not.
 */
exports.HEADLINE_MAX_CHARS = 200;
/**
 * THE READ-TOOL CAP. ⚠ Slack's whole five-tool read surface is ~5,000
 * characters and its longest read description is ~430; this is that number,
 * rounded, and it applies to a tool with NO `op` enum — one job, one shape,
 * nothing to disambiguate.
 *
 * ⚠ A tool with an `op` enum is budgeted by {@link DESCRIPTION_MAX_CHARS}
 * instead, and the reason is mechanical rather than editorial: `parity.test.ts`
 * requires every enum op to appear as a quoted `"op_name"` with a gloss, so a
 * fourteen-op tool has a floor a one-job tool does not.
 *
 * ⚠ **IT BOUNDS THE HAND-WRITTEN HALF, AND THAT DISTINCTION IS THE WHOLE
 * DESIGN.** `cap` is measured against headline + policy + routing + body — the
 * prose somebody typed, which is the half that grows one honest sentence at a
 * time and the half this wave exists to cut. The GENERATED tail (limits from
 * the zod shape, errors from `tool-errors.ts`, examples as JSON) is excluded,
 * because it cannot drift and cannot be padded: every character of it is
 * derived from a declaration that something else already enforces, and capping
 * it would mean buying prose back by deleting the error code an agent matches
 * on. The WHOLE served string is still bounded — by
 * {@link DESCRIPTION_MAX_CHARS} in the composer and by the ratchet in
 * `tool-budget.test.ts`, which measures what a client actually receives.
 */
exports.READ_DESCRIPTION_MAX_CHARS = 450;
/**
 * THE DISPATCH-TOOL CAP — ⚠ **~300 tokens, and it is a CEILING rather than a
 * target.** It has governed this surface since T82 and it only ever moves down;
 * `tool-budget.test.ts` holds the number against every tool this server serves,
 * because one tool's description is read on every connection by every agent, so
 * its cost is paid by the sessions that never call it.
 *
 * ⚠ **IT LIVES HERE AND NOT IN `channel-description.ts`, AND THAT IS A CYCLE
 * FIX AS MUCH AS A TIDY** (A14). That file declared it, and then began IMPORTING
 * `composeDescription` from this one — a cycle whose failure mode is a
 * `ReferenceError` at import on a const this module had not yet initialized,
 * i.e. every suite that boots the server, from a change to a description. A
 * style constant belongs in the style module; `channel-description.ts`
 * re-exports it so every existing importer resolves unchanged.
 */
exports.DESCRIPTION_MAX_CHARS = 1200;
/**
 * ⚠ THE ANTI-PATTERN LINE, not a budget. The reference's pattern 12 is that
 * clients truncate; a description past this is not a long description, it is a
 * partly-invisible one. No tool on this surface may exceed it under any
 * ratchet, licence or exception — that is what separates it from
 * `DESCRIPTION_MAX_CHARS`, which a tool may sit above with a recorded decision.
 */
exports.HARD_DESCRIPTION_CEILING = 2000;
/** ⚠ Beyond three, routing stops being a signpost and becomes a table. */
exports.ROUTING_MAX_LINES = 3;
/** Call shapes teach the surface; a wall of JSON re-buys the prose problem. */
exports.EXAMPLES_MAX_CHARS = 300;
/**
 * The description's ERRORS block — the top three codes for a tool, each with
 * its remedy. ⚠ THREE, not all of them: the reference's pattern 3 is "your top
 * failure modes, one line each", and a complete error taxonomy in a pushed
 * string is the prose this whole wave exists to delete.
 */
function renderErrors(errors) {
    const top = errors.slice(0, 3);
    if (top.length === 0)
        return "";
    return `Errors: ${top
        .map((e) => `reason=${e.reason} — ${e.meaning}; retry=${e.retry}`)
        .join(" · ")}`;
}
/**
 * The description's EXAMPLES block. ⚠ Call shapes as JSON, which is what the
 * agent has to produce — the reference's pattern 8, and the reason
 * `notion-get-users` teaches its whole surface in six lines.
 *
 * ⚠ Throws past {@link EXAMPLES_MAX_CHARS} rather than clipping. A clipped
 * example is invalid JSON teaching an invalid call, and a build-time throw is
 * how that becomes a test failure instead of a served string.
 */
function renderExamples(calls) {
    const block = `e.g. ${calls.map((c) => JSON.stringify(c)).join(" · ")}`;
    if (block.length > exports.EXAMPLES_MAX_CHARS) {
        throw new Error(`examples are ${block.length} chars, over the ${exports.EXAMPLES_MAX_CHARS} cap — drop one, or shorten a value:\n${block}`);
    }
    return block;
}
/**
 * ⚠ THE ONE SOURCE OF EVERY NUMBER IN EVERY DESCRIPTION. It reads the zod shape
 * a tool actually registers — through `z.toJSONSchema`, the same conversion the
 * MCP SDK publishes to clients — so a description cannot state a cap the schema
 * does not enforce, and raising a cap in code cannot leave a stale number in
 * prose.
 *
 * ⚠ IT IS WHY NO `.describe()` ON THIS SURFACE HAND-TYPES A LIMIT ANY MORE. A
 * bound already reaches the client twice over as `maxLength` / `minimum` /
 * `maximum` keywords; a third copy inside the describe was one fact pushed
 * three times on every connection, and it was the copy that went stale.
 * `tool-style.test.ts` fails a `.describe()` that types a bound back in.
 */
function boundsOf(shape) {
    const schema = zod_1.z.toJSONSchema(zod_1.z.object(shape), { io: "input" });
    const bounds = [];
    for (const [name, prop] of Object.entries(schema.properties ?? {})) {
        const phrase = boundPhrase(prop);
        if (phrase)
            bounds.push({ name, phrase: `${name} ${phrase}` });
    }
    return bounds;
}
/** One property's bound as a phrase, or "" when it declares none. */
function boundPhrase(prop) {
    const num = (k) => typeof prop[k] === "number" ? prop[k] : null;
    const maxLength = num("maxLength");
    if (maxLength !== null)
        return `≤${maxLength} chars`;
    const min = num("minimum");
    const max = num("maximum");
    if (min !== null && max !== null)
        return `${min}–${max}`;
    if (max !== null)
        return `≤${max}`;
    if (min !== null)
        return `≥${min}`;
    return "";
}
/**
 * The description's LIMITS block, or "" for a shape with no bounds.
 *
 * ⚠ THE CONSEQUENCE IS PART OF THE SENTENCE, and that is the reference's
 * pattern 4 rather than a flourish: "MAXIMUM 5 keywords; exceeding this returns
 * a validation error" is treated as real, where a bare number reads as advice.
 *
 * @param only restrict to these params — a fourteen-op tool has bounds nobody
 * needs in a pushed string, and the ones worth stating are the ones a caller
 * gets wrong. Omitted, every bound is rendered.
 */
function renderLimits(shape, only) {
    const bounds = boundsOf(shape).filter((b) => !only || only.includes(b.name));
    if (bounds.length === 0)
        return "";
    return `Limits: ${bounds
        .map((b) => b.phrase)
        .join(" · ")}. Exceeding one returns a validation error.`;
}
/**
 * Assemble one description in the house order, and REFUSE to build one that
 * breaks the shape.
 *
 * ⚠ IT THROWS RATHER THAN TRIMS. Every check here is a rule this surface holds
 * — the headline window, the routing ceiling, the cap — and a renderer that
 * quietly trims to satisfy one is a renderer that deletes a security sentence
 * to fit an op bullet. The throw fires at import, so the failure lands on
 * whoever wrote the sentence rather than on an agent months later.
 */
function composeDescription(spec) {
    if (spec.headline.length > exports.HEADLINE_MAX_CHARS) {
        throw new Error(`headline is ${spec.headline.length} chars, over the ${exports.HEADLINE_MAX_CHARS} window a truncating client guarantees: ${spec.headline}`);
    }
    if (spec.routing.length > exports.ROUTING_MAX_LINES) {
        throw new Error(`${spec.routing.length} routing lines, over the ${exports.ROUTING_MAX_LINES}-line ceiling — routing is a signpost, not a table`);
    }
    const blocks = [
        `${spec.headline} ${spec.policy}`,
        ...(spec.routing.length > 0 ? [spec.routing.join(" ")] : []),
        ...(spec.body ?? []),
    ];
    const prose = blocks.join("\n\n");
    if (prose.length > spec.cap) {
        throw new Error(`prose is ${prose.length} chars, over its ${spec.cap} cap — move standing doctrine into an MCP resource rather than raising the number:\n${prose}`);
    }
    const limits = spec.limits
        ? renderLimits(spec.limits.shape, spec.limits.only)
        : "";
    const errors = spec.errors ? renderErrors(spec.errors) : "";
    const examples = spec.examples ? renderExamples(spec.examples) : "";
    // ⚠ ONE trailing block, so the machine-readable tail is one skimmable
    // paragraph rather than three headings competing with the op bullets above.
    const tail = [limits, errors, examples].filter(Boolean).join("\n");
    const description = tail ? `${prose}\n\n${tail}` : prose;
    if (description.length > exports.HARD_DESCRIPTION_CEILING) {
        throw new Error(`description is ${description.length} chars, past the ${exports.HARD_DESCRIPTION_CEILING} truncation line no tool may cross:\n${description}`);
    }
    return description;
}
