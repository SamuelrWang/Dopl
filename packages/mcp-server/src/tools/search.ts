/**
 * `dopl_search` — one ranked search across the workspace. Knowledge
 * entries use the backend hybrid (embeddings + full-text) search;
 * skills and ontology objects match on their name/trigger metadata.
 * Every hit carries the stable handle for the follow-up read.
 */

import { z } from "zod";
import type { DoplClient, OntologySummary } from "@dopl/client";
import { inlineOr } from "./narration";
import { clippedNote } from "./ontology-clipped";
import { partialRead } from "./partial-read";
import { ok, type RegisterTool, type ToolResponse } from "./respond";

const EMPTY_ONTOLOGY: OntologySummary = { clusters: [], objects: {} };

/** A result with nothing nameable left after neutralization. */
const NO_NAME = "`(unnamed)`";

/**
 * A knowledge-entry search snippet, as a value.
 *
 * The `<b>` highlight tags the backend wraps matched terms in used to become
 * `**` — our own markdown, added to text we do not control, on a bullet line
 * with no framing. The tags are dropped instead and the snippet neutralized:
 * losing the bold costs a nicety, and a snippet is an EXCERPT OF A BODY spliced
 * into narration, which is exactly the shape this sweep exists to close. The
 * words survive, which is the half that makes a hit pickable.
 */
function snippet(raw: string): string {
  return inlineOr(raw.replace(/<\/?b>/g, ""), "`(no snippet)`");
}

const SEARCH_DESCRIPTION = `Ranked search across THREE domains at once: knowledge entries, skills, and ontology objects. Returns grouped hits with the handle to read each: dopl_kb(op="read_file"), dopl_skill(op="get"), dopl_ontology(op="get"). Prefer this over per-domain listing when you don't already know where something lives.

WHAT IT DOES NOT COVER, because a miss here is not evidence of absence: the CHAT ARCHIVE, members, teams and channels are not searched at all (dopl_chats(op="list", query=...) is the archive's own filter). Only knowledge entries are matched on their BODIES; skills and ontology objects are matched on names and short trigger metadata only, so a term that appears solely inside a SKILL.md will not be found. Only ACTIVE skills are searched, and only what you can see. Every group is capped at \`limit\`; a group whose backing read FAILED still shows "No matches", but the failure is NAMED in a PARTIAL READ notice on the result, so a group with no such notice against it really was searched.

Params: query (required; all terms must appear, punctuation-folded), limit (max hits per group, default 8).`;

/**
 * "Showing N of M" for one group, or nothing when the group was not truncated.
 * Both numbers come from a list already in memory — the cap is applied HERE —
 * so this is free, which is the test a result-side scope line has to pass.
 */
function more(matched: number, shown: number, noun: string): string[] {
  return matched > shown
    ? [`_Showing ${shown} of ${matched} matching ${noun}. Raise \`limit\` or narrow the query._`]
    : [];
}

/**
 * WHY "No matches" IS THE WEAKEST LINE IN THIS RESULT.
 *
 * Two of the three groups match on NAMES AND TRIGGER METADATA ONLY, one whole
 * domain (the chat archive) is not searched at all, and drafts are excluded
 * from the skills group. An agent reading this result as "the workspace does
 * not contain X" is wrong in three different ways, and the description alone
 * does not reach an agent that has already called the tool.
 *
 * The fourth way was the worst and is now closed: every backing read was
 * wrapped in `.catch(() => [])`, so a group that FAILED rendered exactly like a
 * group with nothing in it. It still shows "No matches" — one broken domain
 * should not fail the search — but `notice` names it, and the footer now says
 * that a group NOT named there really was searched.
 */
function scopeNote(limit: number, notice: string): string {
  return `_${notice}Scope: max ${limit} per group. Only knowledge entries are matched on their BODIES; skills and ontology objects on names and trigger metadata only, so a term living inside a SKILL.md is not findable here. Drafts are excluded from Skills. The CHAT ARCHIVE is not searched at all (dopl_chats(op="list", query=...)). A group whose read failed still shows "No matches" and is named in a PARTIAL READ notice opening this line; no group here is proof of absence._`;
}

export function registerSearchTool(register: RegisterTool, client: DoplClient): void {
  register(
    "dopl_search",
    SEARCH_DESCRIPTION,
    {
      query: z.string().min(1).describe("What to find."),
      // coerce: MCP clients sometimes send numbers as strings; strict
      // z.number() rejects them with an opaque -32602.
      limit: z.coerce.number().int().min(1).max(25).optional().describe("Max hits per group (default 8)."),
    },
    async (args): Promise<ToolResponse> => {
      const limit = args.limit ?? 8;
      // Tokenize + punctuation-fold both the query and the haystack so
      // "duplicate name" matches "duplicate-name", word order doesn't
      // matter, and every term must appear (AND). A whitespace-only or
      // punctuation-only query yields zero terms → matches nothing,
      // instead of the old whole-query .includes() that missed
      // near-verbatim multi-word queries and dumped everything for a
      // lone space (audit fix F-15). Knowledge entries still use the
      // backend hybrid search; this only governs skills/objects.
      const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const terms = fold(args.query).split(" ").filter(Boolean);
      const matches = (...fields: Array<string | null | undefined>) => {
        if (terms.length === 0) return false;
        const hay = ` ${fields.map((f) => fold(f ?? "")).join(" ")} `;
        return terms.every((t) => hay.includes(t));
      };

      // Fail-soft as before — one broken domain must not fail the search — but
      // the failure is recorded instead of swallowed. Labels match the group
      // headings below, so the notice names the "No matches" the reader sees.
      const reads = partialRead();
      const [entryHits, skills, ontology] = await Promise.all([
        reads.soft("Knowledge entries", client.searchKb(args.query, { limit }), []),
        reads.soft("Skills", client.listSkills(), []),
        // THE SUMMARY PROJECTION, NOT THE GRAPH (P0-3). The ontology group
        // matches on `name` and `subtitle` and renders `id` plus a container
        // name off `childIds` — four fields, all of them in the cheap view.
        // The bare `getOntology()` this replaces shipped every `attributes`,
        // `methods`, `template` and cluster `layout` in the workspace so that
        // three of them could be read. Measured on a 366-object workspace:
        // 634 KB against 82 KB, on a tool an agent calls when it does NOT yet
        // know where something lives — i.e. speculatively, and often.
        reads.soft(
          "Ontology objects",
          client.getOntology({ view: "summary" }),
          EMPTY_ONTOLOGY,
        ),
      ]);

      // The query echo is the caller's own argument, but a backtick in it would
      // still escape this span and put the tail back into the heading.
      const lines: string[] = [`# Search: ${inlineOr(args.query, "`(unreadable query)`")}`];

      lines.push("", "## Knowledge entries");
      if (entryHits.length === 0) lines.push("_No matches._");
      for (const h of entryHits.slice(0, limit)) {
        lines.push(
          `- ${inlineOr(h.title, NO_NAME)} (entry id: \`${h.entryId}\`) — ${snippet(h.snippet)}`,
        );
      }

      // Each `.slice(limit)` below discards matches we have already counted, so
      // "showing N of M" is free here — no second query, no second scan. It was
      // the absence of exactly this line that made a capped group and an
      // exhausted one render identically.
      const skillMatches = skills.filter(
        (s) => s.status === "active" && matches(s.name, s.description, s.whenToUse),
      );
      const skillHits = skillMatches.slice(0, limit);
      lines.push("", "## Skills");
      if (skillHits.length === 0) lines.push("_No matches._");
      for (const s of skillHits) {
        const trigger = inlineOr(s.whenToUse || s.description, "`(no trigger described)`");
        lines.push(`- ${inlineOr(s.name, NO_NAME)} \`${s.slug}\` — ${trigger}`);
      }
      lines.push(...more(skillMatches.length, skillHits.length, "skills"));

      const objectMatches = Object.values(ontology.objects).filter((o) =>
        matches(o.name, o.subtitle),
      );
      const objectHits = objectMatches.slice(0, limit);
      lines.push("", "## Ontology objects");
      if (objectHits.length === 0) lines.push("_No matches._");
      const containerOf = (id: string) => {
        const name = Object.values(ontology.objects).find((c) =>
          c.childIds.includes(id),
        )?.name;
        // The container's name is another object's member-typed name, not a
        // kind the server assigned — only the "column" fallback is ours.
        return name ? inlineOr(name, NO_NAME) : "column";
      };
      for (const o of objectHits) {
        const subtitle = o.subtitle ? ` — ${inlineOr(o.subtitle, "")}` : "";
        lines.push(
          `- ${inlineOr(o.name, NO_NAME)} (${containerOf(o.id)} · id: \`${o.id}\`)${subtitle}`
        );
      }
      lines.push(...more(objectMatches.length, objectHits.length, "ontology objects"));
      // A CLIPPED read is a different failure from a capped GROUP, and it is
      // the one this result cannot otherwise show: `more()` reports what the
      // per-group cap hid from a set we scanned, while a clip means the set we
      // scanned was itself a prefix — so "No matches" above would be a claim
      // about objects this call never saw. It sits with the group it qualifies,
      // not in the footer, for the reason the footer note itself gives.
      if (ontology.truncated) {
        lines.push(
          clippedNote(
            "the ontology group searched a prefix of the graph and a match outside it could not appear",
          ),
        );
      }

      // GROUPS, not domains: the three reads are exactly the three groups
      // above. Four until the workflow retirement (2026-08-07; deleted
      // 2026-08-11) — the denominator moves with the reads, never
      // independently of them.
      lines.push("", scopeNote(limit, reads.notice(3, "groups")));
      return ok(lines.join("\n"));
    }
  );
}
