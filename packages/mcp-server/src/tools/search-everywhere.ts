/**
 * `dopl_search(scope="everywhere")`: the fan-out. Each leg is an ordinary fenced single-scope
 * search inside its own `workspaceContext.run` — never one query over a workspace set (no new
 * fence). Every hit renders under its scope's heading (provenance is structural; never merge
 * scopes), a failed leg is named, and the leg list IS the locked list (`searchLegs`), so a locked
 * session searches its container alone. The registrar charged one scope; the rest are charged here,
 * sequentially, before each leg runs, and running out stops the fan-out and is named.
 */

import { workspaceContext } from "@dopl/client";
import type { DoplClient } from "@dopl/client";
import type { ChargeCredit } from "../registrar.js";
import { inlineOr, NO_NAME } from "./narration.js";
import type { SearchLeg } from "../workspace-directory.js";
import type { ToolResponse } from "./respond.js";
import {
  entryAddress,
  more,
  ONTOLOGY_CLIPPED_NOTE,
  searchScope,
  snippet,
  type Matcher,
} from "./search-scope.js";

/** A latency budget (each leg is four reads, legs are sequential); a truncation is always named. */
export const MAX_SCOPES = 6;

interface LegResult {
  leg: SearchLeg;
  lines: string[];
}

type Truncation =
  | { kind: "none" }
  | { kind: "cap"; searched: number; total: number }
  | { kind: "credits"; searched: number; total: number; refusal: ToolResponse };

/** The heading is the provenance: what the scope is (never "workspace" for a container) plus the
 *  slug/id a single-scope follow-up needs. */
function heading(leg: SearchLeg): string {
  const where = leg.slug
    ? `${leg.kind} · slug \`${leg.slug}\` · id \`${leg.id}\``
    : `${leg.kind} · id \`${leg.id}\``;
  return `## ${inlineOr(leg.label, NO_NAME)} (${where})`;
}

/** One leg, inside its own AsyncLocalStorage scope so every call carries that `X-Workspace-Id`. */
async function searchOneLeg(
  client: DoplClient,
  leg: SearchLeg,
  query: string,
  limit: number,
  matches: Matcher,
): Promise<LegResult> {
  return workspaceContext.run(leg.id, async () => {
    const found = await searchScope(client, {
      query,
      limit,
      matches,
      inHomeChannel: leg.kind === "home_channel",
    });

    const lines: string[] = [heading(leg)];
    let hits = 0;

    if (found.entries.length > 0) {
      hits += found.entries.length;
      lines.push("", "### Knowledge entries");
      for (const h of found.entries) {
        lines.push(`- ${inlineOr(h.title, NO_NAME)} (${entryAddress(h)}) — ${snippet(h.snippet)}`);
      }
    }

    if (found.skills.hits.length > 0) {
      hits += found.skills.hits.length;
      lines.push("", "### Skills");
      for (const s of found.skills.hits) {
        lines.push(
          `- ${inlineOr(s.name, NO_NAME)} \`${s.slug}\` — ${inlineOr(s.whenToUse || s.description, "`(no trigger described)`")}`,
        );
      }
      lines.push(...more(found.skills, "skills"));
    }

    if (found.objects.hits.length > 0) {
      hits += found.objects.hits.length;
      lines.push("", "### Ontology objects");
      for (const o of found.objects.hits) {
        lines.push(`- ${inlineOr(o.name, NO_NAME)} (id: \`${o.id}\`)`);
      }
      lines.push(...more(found.objects, "ontology objects"));
    }
    if (found.ontologyTruncated) lines.push(ONTOLOGY_CLIPPED_NOTE);

    if (found.identities.hits.length > 0) {
      hits += found.identities.hits.length;
      lines.push("", "### Agent identities");
      for (const ident of found.identities.hits) {
        lines.push(
          `- ${inlineOr(ident.name, NO_NAME)} (id: \`${ident.id}\` · seen by ${found.audienceOf(ident)})`,
        );
      }
      lines.push(...more(found.identities, "agent identities"));
    }

    // An empty scope keeps its heading: "searched, nothing" must not look like "not searched".
    if (hits === 0) lines.push("", "_No matches in this scope._");
    if (found.notice) lines.push("", `_${found.notice}_`);
    return { leg, lines };
  });
}

/** The fan-out: body lines plus the coverage sentence. `alreadyCharged` is matched by id, so the
 *  registrar's leg is never charged twice. */
export async function fanOut(
  client: DoplClient,
  charge: ChargeCredit,
  opts: {
    legs: SearchLeg[];
    query: string;
    limit: number;
    alreadyCharged: string | null;
    matches: Matcher;
  },
): Promise<{ lines: string[]; coverage: string; refusal: ToolResponse | null }> {
  const total = opts.legs.length;
  const planned = opts.legs.slice(0, MAX_SCOPES);
  let truncation: Truncation =
    planned.length < total
      ? { kind: "cap", searched: planned.length, total }
      : { kind: "none" };

  const results: LegResult[] = [];
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
    results.push(
      await searchOneLeg(client, leg, opts.query, opts.limit, opts.matches),
    );
  }

  const lines: string[] = [];
  for (const r of results) lines.push(...r.lines, "");

  // The count is what was actually searched, never the leg list's length.
  const searched = results.length;
  const scopeWord = searched === 1 ? "scope" : "scopes";
  let coverage = `Searched ${searched} ${scopeWord} of ${total} you can reach, each one an ordinary search of that scope alone.`;
  if (truncation.kind === "cap") {
    coverage += ` ⚠ TRUNCATED at the ${MAX_SCOPES}-scope cap: ${total - searched} scope(s) were NOT searched and nothing here says anything about them. Narrow with \`container=\` and scope="here" to reach one directly.`;
  } else if (truncation.kind === "credits") {
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
