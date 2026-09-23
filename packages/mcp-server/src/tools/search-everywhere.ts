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
export const MAX_SCOPES = 6;

/** One leg's hits, already capped. */
interface LegResult {
  leg: SearchLeg;
  lines: string[];
}

/** Why the fan-out stopped short of the leg list. */
type Truncation =
  | { kind: "none" }
  | { kind: "cap"; searched: number; total: number }
  | { kind: "credits"; searched: number; total: number; refusal: ToolResponse };

/**
 * ⚠ THE HEADING IS THE PROVENANCE, so it says WHAT the scope is as well as which.
 * A container rendered as "workspace" would advertise it as one, which INVARIANTS
 * §4A forbids everywhere else on this surface; a workspace rendered without its
 * slug loses the handle a follow-up single-scope call needs.
 */
function heading(leg: SearchLeg): string {
  const where = leg.slug
    ? `${leg.kind} · slug \`${leg.slug}\` · id \`${leg.id}\``
    : `${leg.kind} · id \`${leg.id}\``;
  return `## ${inlineOr(leg.label, NO_NAME)} (${where})`;
}

/**
 * Search ONE leg. ⚠ Runs inside that leg's own AsyncLocalStorage scope so every
 * `client.*` call carries the right `X-Workspace-Id` — this, and nothing else,
 * is what makes each leg an ordinary fenced request.
 */
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
      for (const t of found.identities.hits) {
        lines.push(
          `- ${inlineOr(t.name, NO_NAME)} (id: \`${t.id}\` · seen by ${found.audienceOf(t)})`,
        );
      }
      lines.push(...more(found.identities, "agent identities"));
    }

    // ⚠ AN EMPTY SCOPE STILL GETS ITS HEADING. Dropping it would make "searched,
    // nothing here" and "not searched" the same picture, which is the exact
    // failure `partialRead` exists to prevent, one level up.
    if (hits === 0) lines.push("", "_No matches in this scope._");
    if (found.notice) lines.push("", `_${found.notice}_`);
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
    results.push(
      await searchOneLeg(client, leg, opts.query, opts.limit, opts.matches),
    );
  }

  const lines: string[] = [];
  for (const r of results) lines.push(...r.lines, "");

  // ⚠ THE COUNT IS WHAT WAS ACTUALLY SEARCHED, never the leg list's length, and
  // never a promise of exhaustiveness.
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
