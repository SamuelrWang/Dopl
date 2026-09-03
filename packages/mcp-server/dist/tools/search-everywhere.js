"use strict";
/**
 * search-everywhere.ts — `dopl_search(scope="everywhere")`: THE FAN-OUT.
 *
 * ── THE FOUR PROPERTIES THIS SHAPE EXISTS TO BUY (plan §4.2) ───────────────
 *
 * 1. 🔒 **NO NEW FENCE.** Each leg is N ORDINARY, ALREADY-FENCED CALLS — the
 *    exact request a single-scope search makes, run inside that leg's own
 *    `workspaceContext.run(...)`. Layer A, B1, `canSeeBase` and the guest floors
 *    all apply per leg with no re-statement, and a re-statement is what F-336 and
 *    the `service-shared.ts` mirror-list exist to warn about. **Never widen this
 *    into one query over a workspace set.**
 * 2. **PROVENANCE IS STRUCTURAL.** A hit cannot render without its scope
 *    heading, so "which room is this from" is answered by construction rather
 *    than by a label somebody can forget. ⚠ NO RESULT MAY MERGE TWO SCOPES UNDER
 *    ONE HEADING — a "flat, deduplicated" convenience rendering would silently
 *    delete the design.
 * 3. **A FAILED LEG IS NAMED, NEVER RENDERED AS EMPTY.** "No matches in Acme"
 *    and "Acme could not be read" must never look alike.
 * 4. 🔒 **B3 IS RESPECTED BECAUSE THE LEG LIST *IS* THE LOCKED LIST**
 *    (`workspace-directory.ts › searchLegs`). A locked session searches its container and
 *    learns nothing about the existence of anything else.
 *
 * ── THE TWO COSTS, PAID RATHER THAN HIDDEN ────────────────────────────────
 *
 * **CREDITS.** `registrar.ts` charges ONCE, for the resolved workspace, before
 * the handler runs. So this module charges the ADDITIONAL legs explicitly
 * (Samuel's ruling Q3 (b), 2026-08-28) and the total equals the number of scopes
 * searched. ⚠ Legs run SEQUENTIALLY for exactly this reason: the meter has to
 * gate the work, which is the same "charge, then run" ordering the registrar
 * keeps. Out of credits STOPS the fan-out and is NAMED — it never silently
 * shortens the answer.
 *
 * **LATENCY.** N × the per-leg fan of four soft reads, bounded by
 * {@link MAX_SCOPES}. The result states the scope count it ACTUALLY searched and
 * never promises exhaustiveness — `search.ts › scopeNote`'s discipline ("no
 * group here is proof of absence") extended to scopes verbatim.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SCOPES = void 0;
exports.fanOut = fanOut;
const client_1 = require("@dopl/client");
const narration_js_1 = require("./narration.js");
const partial_read_js_1 = require("./partial-read.js");
/**
 * The hard cap on scopes one call fans out over.
 *
 * ⚠ SIX, AND THE NUMBER IS A LATENCY BUDGET RATHER THAN A TASTE. Each leg is
 * four concurrent reads and the legs are sequential (the meter gates them), so
 * six is ~24 loopback requests on one tool call. Raising it makes a speculative
 * search a hold; lowering it makes the truncation the common case. ⚠ Whatever it
 * is, the truncation is NAMED — a cap the result does not mention is a silent
 * lie about coverage.
 */
exports.MAX_SCOPES = 6;
const EMPTY_ONTOLOGY = { clusters: [], objects: {} };
const NO_NAME = "`(unnamed)`";
/**
 * ⚠ THE HEADING IS THE PROVENANCE, so it says WHAT the scope is as well as which.
 * A container rendered as "workspace" would advertise it as one, which INVARIANTS
 * §4A forbids everywhere else on this surface; a workspace rendered without its
 * slug loses the handle a follow-up single-scope call needs.
 */
function heading(leg) {
    const where = leg.slug
        ? `${leg.kind} · slug \`${leg.slug}\` · id \`${leg.id}\``
        : `${leg.kind} · id \`${leg.id}\``;
    return `## ${(0, narration_js_1.inlineOr)(leg.label, NO_NAME)} (${where})`;
}
/**
 * Search ONE leg. ⚠ Runs inside that leg's own AsyncLocalStorage scope so every
 * `client.*` call carries the right `X-Workspace-Id` — this, and nothing else,
 * is what makes each leg an ordinary fenced request.
 */
async function searchOneLeg(client, leg, query, limit, matches) {
    return client_1.workspaceContext.run(leg.id, async () => {
        const reads = (0, partial_read_js_1.partialRead)();
        const [entryHits, skills, ontology, templates] = await Promise.all([
            reads.soft("Knowledge entries", client.searchKb(query, { limit }), []),
            reads.soft("Skills", client.listSkills(), []),
            reads.soft("Ontology objects", client.getOntology({ view: "summary" }), EMPTY_ONTOLOGY),
            reads.soft("Agent templates", client.listAgentTemplates(), []),
        ]);
        const lines = [heading(leg)];
        let hits = 0;
        const entries = entryHits.slice(0, limit);
        if (entries.length > 0) {
            hits += entries.length;
            lines.push("", "### Knowledge entries");
            for (const h of entries) {
                lines.push(`- ${(0, narration_js_1.inlineOr)(h.title, NO_NAME)} (entry id: \`${h.entryId}\`) — ${(0, narration_js_1.inlineOr)(h.snippet.replace(/<\/?b>/g, ""), "`(no snippet)`")}`);
            }
        }
        const skillHits = skills
            .filter((s) => s.status === "active" && matches(s.name, s.description, s.whenToUse))
            .slice(0, limit);
        if (skillHits.length > 0) {
            hits += skillHits.length;
            lines.push("", "### Skills");
            for (const s of skillHits) {
                lines.push(`- ${(0, narration_js_1.inlineOr)(s.name, NO_NAME)} \`${s.slug}\` — ${(0, narration_js_1.inlineOr)(s.whenToUse || s.description, "`(no trigger described)`")}`);
            }
        }
        const objectHits = Object.values(ontology.objects)
            .filter((o) => matches(o.name, o.subtitle))
            .slice(0, limit);
        if (objectHits.length > 0) {
            hits += objectHits.length;
            lines.push("", "### Ontology objects");
            for (const o of objectHits) {
                lines.push(`- ${(0, narration_js_1.inlineOr)(o.name, NO_NAME)} (id: \`${o.id}\`)`);
            }
        }
        const templateHits = templates
            .filter((t) => matches(t.name, t.description))
            .slice(0, limit);
        if (templateHits.length > 0) {
            hits += templateHits.length;
            lines.push("", "### Agent templates");
            for (const t of templateHits) {
                lines.push(`- ${(0, narration_js_1.inlineOr)(t.name, NO_NAME)} (id: \`${t.id}\` · ${t.visibility})`);
            }
        }
        // ⚠ AN EMPTY SCOPE STILL GETS ITS HEADING. Dropping it would make "searched,
        // nothing here" and "not searched" the same picture, which is the exact
        // failure `partialRead` exists to prevent, one level up.
        const notice = reads.notice(4, "groups");
        if (hits === 0)
            lines.push("", "_No matches in this scope._");
        if (notice)
            lines.push("", `_${notice}_`);
        return { leg, lines };
    });
}
/**
 * THE FAN-OUT. Returns the rendered body plus the coverage sentence.
 *
 * ⚠ `alreadyCharged` IS THE LEG THE REGISTRAR ALREADY PAID FOR. Charging it
 * again is the double-count this argument exists to prevent; it is matched by
 * ID, not by position, because the resolved workspace is not always the first
 * leg.
 */
async function fanOut(client, charge, opts) {
    const total = opts.legs.length;
    const planned = opts.legs.slice(0, exports.MAX_SCOPES);
    let truncation = planned.length < total
        ? { kind: "cap", searched: planned.length, total }
        : { kind: "none" };
    const results = [];
    for (const leg of planned) {
        if (leg.id !== opts.alreadyCharged) {
            const denied = await charge(leg.id);
            if (denied) {
                // ⚠ STOP, KEEP WHAT WAS SEARCHED, AND SAY SO. Discarding the completed
                // legs would waste credits already spent; continuing unpaid would make
                // the meter and the work disagree, which is the whole reason per-leg
                // billing was ruled in.
                truncation = {
                    kind: "credits",
                    searched: results.length,
                    total,
                    refusal: denied,
                };
                break;
            }
        }
        results.push(await searchOneLeg(client, leg, opts.query, opts.limit, opts.matches));
    }
    const lines = [];
    for (const r of results)
        lines.push(...r.lines, "");
    // ⚠ THE COUNT IS WHAT WAS ACTUALLY SEARCHED, never the leg list's length, and
    // never a promise of exhaustiveness.
    const searched = results.length;
    const scopeWord = searched === 1 ? "scope" : "scopes";
    let coverage = `Searched ${searched} ${scopeWord} of ${total} you can reach, each one an ordinary search of that scope alone.`;
    if (truncation.kind === "cap") {
        coverage += ` ⚠ TRUNCATED at the ${exports.MAX_SCOPES}-scope cap: ${total - searched} scope(s) were NOT searched and nothing here says anything about them. Narrow with \`workspace=\` and scope="here" to reach one directly.`;
    }
    else if (truncation.kind === "credits") {
        coverage += ` ⚠ TRUNCATED — the fan-out stopped when this workspace ran out of MCP credits, so ${total - searched} scope(s) were NOT searched. What is above was searched and paid for; the rest is unknown, not empty.`;
    }
    if (searched === 0) {
        coverage = `NOTHING was searched — no scope was reached, so this result says nothing about what exists. ${coverage}`;
    }
    return {
        lines,
        coverage,
        refusal: truncation.kind === "credits" && searched === 0 ? truncation.refusal : null,
    };
}
