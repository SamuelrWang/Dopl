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
 * ⚠ EVERY RULE ABOVE IS ENFORCED IN `tool-style.test.ts`, against the
 * descriptions AS SERVED through a real `listTools()` — it is the mechanically
 * checkable half of `docs/MCP-TOOL-DESCRIPTION-CHECKLIST.md`, which holds the
 * rows that stay a hand review. A style guide nothing measures is a style
 * nobody holds.
 *
 * ⚠ WHAT THIS FILE DELIBERATELY DOES NOT DO — the anti-patterns of the same
 * reference, pinned by `tool-style.test.ts`: no telemetry parameter billed to
 * the caller's context (HubSpot's `chatInsights`), no regex date validator in a
 * published schema, and no description over {@link HARD_DESCRIPTION_CEILING}.
 */
import { type ZodRawShape } from "zod";
import type { ToolError } from "./tool-errors";
/**
 * THE HEADLINE WINDOW. ⚠ A property of the CLIENTS, not of this server: the
 * live probe of the same three production servers (2026-09-02) found Notion's
 * search, Notion's fetch and Slack's search all arriving CUT OFF mid-sentence,
 * with everything past the cut invisible at decision time. The first sentence
 * is therefore the only part guaranteed to be read, and it must carry what the
 * tool returns and what it does not.
 */
export declare const HEADLINE_MAX_CHARS = 200;
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
export declare const READ_DESCRIPTION_MAX_CHARS = 450;
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
export declare const DESCRIPTION_MAX_CHARS = 1200;
/**
 * ⚠ THE ANTI-PATTERN LINE, not a budget. The reference's pattern 12 is that
 * clients truncate; a description past this is not a long description, it is a
 * partly-invisible one. No tool on this surface may exceed it under any
 * ratchet, licence or exception — that is what separates it from
 * `DESCRIPTION_MAX_CHARS`, which a tool may sit above with a recorded decision.
 */
export declare const HARD_DESCRIPTION_CEILING = 2000;
/** ⚠ Beyond three, routing stops being a signpost and becomes a table. */
export declare const ROUTING_MAX_LINES = 3;
/** Call shapes teach the surface; a wall of JSON re-buys the prose problem. */
export declare const EXAMPLES_MAX_CHARS = 300;
/**
 * The description's ERRORS block — the top three codes for a tool, each with
 * its remedy. ⚠ THREE, not all of them: the reference's pattern 3 is "your top
 * failure modes, one line each", and a complete error taxonomy in a pushed
 * string is the prose this whole wave exists to delete.
 */
export declare function renderErrors(errors: readonly ToolError[]): string;
/**
 * The description's EXAMPLES block. ⚠ Call shapes as JSON, which is what the
 * agent has to produce — the reference's pattern 8, and the reason
 * `notion-get-users` teaches its whole surface in six lines.
 *
 * ⚠ Throws past {@link EXAMPLES_MAX_CHARS} rather than clipping. A clipped
 * example is invalid JSON teaching an invalid call, and a build-time throw is
 * how that becomes a test failure instead of a served string.
 */
export declare function renderExamples(calls: readonly object[]): string;
/** One published parameter's bound, as the JSON Schema publishes it. */
interface Bound {
    name: string;
    /** The rendered phrase, e.g. `query ≤200 chars` or `limit 1–50`. */
    phrase: string;
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
export declare function boundsOf(shape: ZodRawShape): Bound[];
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
export declare function renderLimits(shape: ZodRawShape, only?: readonly string[]): string;
/** What {@link composeDescription} assembles, in the house order. */
export interface DescriptionSpec {
    /**
     * Sentence 1 — ⚠ what it returns AND what it does NOT. Must fit
     * {@link HEADLINE_MAX_CHARS}; `composeDescription` throws otherwise, because a
     * headline that only fits when a client is generous is a headline that some
     * clients never see.
     */
    headline: string;
    /**
     * Sentence 2 — the capability class. `"Read-only."` for a read tool, else the
     * write policy: the safe default and what refuses.
     */
    policy: string;
    /** Up to {@link ROUTING_MAX_LINES} `Use <sibling> for <thing>` sentences. */
    routing: readonly string[];
    /** The tool's own paragraphs: security, op bullets, addressing. */
    body?: readonly string[];
    /** The zod shape the tool registers, and which of its bounds to render. */
    limits?: {
        shape: ZodRawShape;
        only?: readonly string[];
    };
    /** The tool's top-three named errors. */
    errors?: readonly ToolError[];
    /** 3–6 call shapes. */
    examples?: readonly object[];
    /**
     * The PROSE cap this tool is budgeted at — {@link READ_DESCRIPTION_MAX_CHARS}
     * for a tool with no `op` enum, {@link DESCRIPTION_MAX_CHARS} otherwise. ⚠ It
     * bounds the hand-written half only; see that constant's docblock for why.
     * Checked at MODULE LOAD, so an over-budget description cannot be registered
     * at all; `tool-budget.test.ts` then ratchets what is actually served.
     */
    cap: number;
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
export declare function composeDescription(spec: DescriptionSpec): string;
export {};
