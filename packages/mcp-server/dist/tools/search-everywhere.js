"use strict";
/**
 * `dopl_search(scope="everywhere")`: the fan-out. Each leg is an ordinary fenced single-scope
 * search inside its own `workspaceContext.run` — never one query over a workspace set (no new
 * fence). Every hit renders under its scope's heading (provenance is structural; never merge
 * scopes), a failed leg is named, and the leg list IS the locked list (`searchLegs`), so a locked
 * session searches its container alone. The registrar charged one scope; the rest are charged here,
 * sequentially, before each leg runs, and running out stops the fan-out and is named.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SCOPES = void 0;
exports.fanOut = fanOut;
const client_1 = require("@dopl/client");
const narration_js_1 = require("./narration.js");
const search_scope_js_1 = require("./search-scope.js");
const search_app_render_js_1 = require("./search-app-render.js");
/** A latency budget (each leg is five reads, legs are sequential); a truncation is always named. */
exports.MAX_SCOPES = 6;
/** The heading is the provenance: what the scope is (never "workspace" for a container) plus the
 *  slug/id a single-scope follow-up needs. */
function heading(leg) {
    const where = leg.slug
        ? `${leg.kind} · slug \`${leg.slug}\` · id \`${leg.id}\``
        : `${leg.kind} · id \`${leg.id}\``;
    return `## ${(0, narration_js_1.inlineOr)(leg.label, narration_js_1.NO_NAME)} (${where})`;
}
/** One leg, inside its own AsyncLocalStorage scope so every call carries that `X-Workspace-Id`. */
async function searchOneLeg(client, leg, query, limit, matches) {
    return client_1.workspaceContext.run(leg.id, async () => {
        const found = await (0, search_scope_js_1.searchScope)(client, {
            query,
            limit,
            matches,
            inHomeChannel: leg.kind === "home_channel",
            containerId: leg.id,
        });
        const lines = [heading(leg)];
        let hits = 0;
        if (found.entries.length > 0) {
            hits += found.entries.length;
            lines.push("", "### Knowledge entries");
            for (const h of found.entries) {
                lines.push(`- ${(0, narration_js_1.inlineOr)(h.title, narration_js_1.NO_NAME)} (${(0, search_scope_js_1.entryAddress)(h)}) — ${(0, search_scope_js_1.snippet)(h.snippet)}`);
            }
        }
        if (found.skills.hits.length > 0) {
            hits += found.skills.hits.length;
            lines.push("", "### Skills");
            for (const s of found.skills.hits) {
                lines.push(`- ${(0, narration_js_1.inlineOr)(s.name, narration_js_1.NO_NAME)} \`${s.slug}\` — ${(0, narration_js_1.inlineOr)(s.whenToUse || s.description, "`(no trigger described)`")}`);
            }
            lines.push(...(0, search_scope_js_1.more)(found.skills, "skills"));
        }
        if (found.objects.hits.length > 0) {
            hits += found.objects.hits.length;
            lines.push("", "### Ontology objects");
            for (const o of found.objects.hits) {
                lines.push(`- ${(0, narration_js_1.inlineOr)(o.name, narration_js_1.NO_NAME)} (id: \`${o.id}\`)`);
            }
            lines.push(...(0, search_scope_js_1.more)(found.objects, "ontology objects"));
        }
        if (found.ontologyTruncated)
            lines.push(search_scope_js_1.ONTOLOGY_CLIPPED_NOTE);
        if (found.identities.hits.length > 0) {
            hits += found.identities.hits.length;
            lines.push("", "### Agent identities");
            for (const ident of found.identities.hits) {
                lines.push(`- ${(0, narration_js_1.inlineOr)(ident.name, narration_js_1.NO_NAME)} (id: \`${ident.id}\` · seen by ${found.audienceOf(ident)})`);
            }
            lines.push(...(0, search_scope_js_1.more)(found.identities, "agent identities"));
        }
        const appLines = (0, search_app_render_js_1.appGroupLines)(found.app, "###", {
            searched: true,
            skipEmpty: true,
            standard: leg.kind === "workspace",
        });
        for (const g of found.app)
            hits += g.items.length;
        lines.push(...appLines);
        // An empty scope keeps its heading: "searched, nothing" must not look like "not searched".
        if (hits === 0)
            lines.push("", "_No matches in this scope._");
        if (found.notice)
            lines.push("", `_${found.notice}_`);
        return { leg, lines };
    });
}
/** The fan-out: body lines plus the coverage sentence. `alreadyCharged` is matched by id, so the
 *  registrar's leg is never charged twice. */
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
                // Stop, keep what was searched and paid for, and say so.
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
    // The count is what was actually searched, never the leg list's length.
    const searched = results.length;
    const scopeWord = searched === 1 ? "scope" : "scopes";
    let coverage = `Searched ${searched} ${scopeWord} of ${total} you can reach, each one an ordinary search of that scope alone.`;
    if (truncation.kind === "cap") {
        coverage += ` ⚠ TRUNCATED at the ${exports.MAX_SCOPES}-scope cap: ${total - searched} scope(s) were NOT searched and nothing here says anything about them. Narrow with \`container=\` and scope="here" to reach one directly.`;
    }
    else if (truncation.kind === "credits") {
        coverage += ` ⚠ TRUNCATED — the fan-out stopped when you ran out of credits, so ${total - searched} scope(s) were NOT searched. What is above was searched and paid for; the rest is unknown, not empty.`;
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
