/**
 * `dopl_search` — one ranked search across the workspace. Knowledge
 * entries use the backend hybrid (embeddings + full-text) search;
 * skills and ontology objects match on their name/trigger metadata.
 * Every hit carries the stable handle for the follow-up read.
 */

import { z } from "zod";
import { workspaceContext } from "@dopl/client";
import type { DoplClient, OntologySummary } from "@dopl/client";
import type { ChargeCredit } from "../registrar.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { inlineOr, NO_NAME } from "./narration";
import { clippedNote } from "./ontology-clipped";
import { partialRead } from "./partial-read";
import { isConcise, RESPONSE_FORMAT_FIELD } from "./response-size";
import { SEARCH_ERRORS } from "./tool-errors";
import { composeDescription, READ_DESCRIPTION_MAX_CHARS } from "./tool-style";
import { searchLegs } from "../workspace-directory";
import { fanOut, MAX_SCOPES } from "./search-everywhere";
import { ok, type RegisterTool, type ToolResponse } from "./respond";

const EMPTY_ONTOLOGY: OntologySummary = { clusters: [], objects: {} };

/**
 * A knowledge-entry search snippet, as a VALUE. ⚠ Do not turn the backend's
 * `<b>` highlight tags into `**` — that adds our own markdown to text we do not
 * control, on an unframed bullet line. A snippet is an EXCERPT OF A BODY
 * spliced into narration; drop the tags and neutralize.
 */
function snippet(raw: string): string {
  return inlineOr(raw.replace(/<\/?b>/g, ""), "`(no snippet)`");
}

/**
 * 🔒 **THE HANDLE A FOLLOW-UP READ ACTUALLY TAKES** (2026-09-18). An `entryId`
 * is not an address `dopl_kb(op="read_file")` accepts, so a hit used to end one
 * lookup short of useful. ⚠ §8 STALE-CACHE, SPELLED INLINE — `baseSlug` and
 * `path` are absent from an older server's payload, and the id stays on the row
 * either way.
 */
function entryAddress(h: {
  entryId: string;
  baseSlug?: string;
  path?: string;
}): string {
  const where = h.path
    ? `${h.baseSlug ? `base \`${h.baseSlug}\` · ` : ""}path ${inlineOr(h.path, "`(unreadable path)`")} · `
    : "";
  return `${where}entry id: \`${h.entryId}\``;
}

/**
 * ⚠ THE GROUP COUNT IS A CONSTANT, NOT A LITERAL IN THREE PLACES. It is the
 * DENOMINATOR `partialRead`'s notice reports against ("2 of 4 groups could not
 * be read"), and it must move with the reads below and with the description's
 * opening word — never independently of either. Named when the identities group
 * landed (2026-08-28), because the previous shape had the number inline and the
 * word "THREE" spelled out in prose that nothing tied to it.
 */
const SEARCH_GROUP_COUNT = 4;

/**
 * ⚠ THE ONE SHAPE OBJECT — handed to `composeDescription` for its bounds AND to
 * the registrar for enforcement, so a limit an agent reads is a limit the schema
 * applies.
 */
const SEARCH_SHAPE = {
  query: z.string().min(1).describe("What to find."),
  // ⚠ coerce: MCP clients sometimes send numbers as strings, which strict
  // z.number() rejects with an opaque -32602.
  limit: z.coerce.number().int().min(1).max(25).optional().describe("Max hits per group (default 8)."),
  response_format: RESPONSE_FORMAT_FIELD,
  scope: z
    .enum(["here", "everywhere"])
    .optional()
    .describe(
      `Which scopes to search: "here" (DEFAULT) = the one workspace this call resolved to; "everywhere" = every workspace AND home channel you can reach, one fenced search each under per-scope headings, capped at ${MAX_SCOPES} scopes at ONE CREDIT PER SCOPE, with the truncation named in the result.`,
    ),
};


/**
 * ⚠ **RENDERED, NOT WRITTEN** (A14) — `tool-style.ts › composeDescription`, and
 * budgeted at {@link READ_DESCRIPTION_MAX_CHARS}: no `op` enum, one job.
 *
 * ⚠ **THE `scope="everywhere"` PARAGRAPH LEFT, AND IT IS NOT A DELETION.** It
 * said the fan-out is capped, costs one credit per scope and names its own
 * truncation — every word of which `scope`'s own `.describe()` below already
 * says. A description and its arg descriptions are BOTH pushed on every
 * connection, so that was one fact paid for twice, and the copy that goes is
 * the one the reader does not need until it reaches for the argument.
 */
const SEARCH_DESCRIPTION = composeDescription({
  headline:
    "Ranked hits across FOUR domains: knowledge entries, skills, ontology objects, agent identities.",
  policy: "Read-only.",
  // ⚠ ONE ROUTING LINE, AND THE CHAT-ARCHIVE EDGE MOVED INTO THE BODY. It is
  // the same fact either way, and the body is where it belongs: the archive is
  // not a place to go INSTEAD of here, it is a gap in what this searched, which
  // is what the paragraph below is about.
  routing: [
    'Use dopl_kb(op="read_file"), dopl_skill(op="get"), dopl_ontology(op="get") or dopl_agent(op="get") to read a hit.',
  ],
  body: [
    'A miss is not absence: only ENTRIES match on bodies, so a term inside a SKILL.md or an identity\'s INSTRUCTIONS is lost. Members, teams, channels, the CHAT ARCHIVE: unsearched — dopl_chats(op="list") is the archive\'s own filter.',
  ],
  limits: { shape: SEARCH_SHAPE, only: ["limit"] },
  errors: SEARCH_ERRORS,
  examples: [
    { query: "onboarding" },
    { query: "pricing", limit: 5 },
    { query: "pricing", scope: "everywhere" },
  ],
  cap: READ_DESCRIPTION_MAX_CHARS,
});

/**
 * "Showing N of M" for one group, or nothing when untruncated. ⚠ Both numbers
 * come from a list already in memory (the cap is applied HERE), so it is free —
 * the test a result-side scope line has to pass.
 */
function more(matched: number, shown: number, noun: string): string[] {
  return matched > shown
    ? [`_Showing ${shown} of ${matched} matching ${noun}. Raise \`limit\` or narrow the query._`]
    : [];
}

/**
 * ⚠ "No matches" IS THE WEAKEST LINE IN THIS RESULT. Two of the three groups
 * match on NAMES AND TRIGGER METADATA ONLY, the chat archive is not searched at
 * all, and drafts are excluded from skills — so "the workspace does not contain
 * X" is wrong three ways, and the description does not reach an agent that
 * already called the tool.
 *
 * ⚠ A FAILED group renders like an empty one under `.catch(() => [])`. It still
 * shows "No matches" (one broken domain must not fail the search), but `notice`
 * NAMES it, and the footer says a group not named there really was searched.
 */
function scopeNote(limit: number, notice: string, terse: boolean): string {
  // ⚠ WHAT `concise` DROPS IS TEACHING, AND WHAT IT KEEPS IS A FACT ABOUT THIS
  // RESULT. The scope paragraph below is ~750 chars of standing caveat that the
  // tool's own description already carries, re-emitted on every search; the
  // PARTIAL READ notice is different in kind — it says a group did not answer
  // on THIS call, which no description can know — so it survives at either
  // level. See `response-size.ts`.
  // 🔒 **THE RECALL CAP, DISCLOSED ON THIS SURFACE TOO** (S15/S49, 2026-09-18).
  // `dopl_kb`'s own search has said it for months (`knowledge-ops-read.ts ›
  // SEARCH_SCOPE_NOTE`) and this one never did, so an agent reading "2 matches"
  // here read a recall-capped, visibility-filtered SAMPLE as a census. It rides
  // the FOOTER rather than the description because `dopl_search` is held to
  // `READ_DESCRIPTION_MAX_CHARS` (450), the tightest budget on the surface, and
  // a per-call footer is not in the served total at all.
  // ⚠ THE CONCISE FORM CARRIES IT TOO, in one clause: `concise` drops what the
  // DESCRIPTION already says, and the description cannot afford to say this.
  if (terse) {
    return notice
      ? `_${notice}Scope: max ${limit} per group — a recall-capped sample, not a census. See this tool's description._`
      : `_Scope: max ${limit} per group — a recall-capped sample, not a census. See this tool's description._`;
  }
  return `_${notice}Scope: max ${limit} per group, in ONE workspace — this one, with no cross-workspace fan-out. Only knowledge entries are matched on their BODIES; skills, ontology objects and agent identities on names and short metadata only, so a term living inside a SKILL.md or inside an identity's instructions is not findable here. Drafts are excluded from Skills. Agent identities are the ones you can SEE, across both shelves. The CHAT ARCHIVE is not searched at all (dopl_chats(op="list", query=...)). Knowledge entries are a ranked SAMPLE: candidates are capped before ranking, distant matches are dropped, and hits in bases you cannot read are removed after ranking — so fewer hits than \`limit\` does not mean there are no others. A group whose read failed still shows "No matches" and is named with reason=partial_read opening this line; no group here is proof of absence._`;
}

/**
 * ⚠ `directory` AND `charge` ARE OPTIONAL, AND ABSENT MEANS "NO FAN-OUT". Six
 * suites construct this registrar with `(register, client)` alone, and a fan-out
 * is meaningless without the LOCKED leg list anyway — a `scope="everywhere"` on a
 * registrar built without them answers the single-scope search and SAYS it did,
 * rather than quietly searching one scope while the caller believes it searched
 * all of them.
 */
/**
 * ⚠ WIDENING THE **SCOPE** AXIS IS NOT WIDENING THE **DOMAIN** AXIS, and the
 * fan-out result has to say so in its own footer — an agent that reads
 * "everywhere" and gets four groups will otherwise take a miss as evidence of
 * absence across its whole account rather than across four domains of it.
 */
const SCOPE_AXIS_NOTE = `Each scope was searched the same way a single-scope call searches: knowledge entries on their BODIES, skills, ontology objects and agent identities on names and short metadata only, ACTIVE skills only, and only what you can see there. The CHAT ARCHIVE, members, teams and channels are not searched in ANY scope. A wider SCOPE is not a wider DOMAIN — no scope here is proof of absence.`;

export function registerSearchTool(
  register: RegisterTool,
  client: DoplClient,
  directory?: WorkspaceDirectory,
  charge?: ChargeCredit,
): void {
  register(
    "dopl_search",
    SEARCH_DESCRIPTION,
    SEARCH_SHAPE,
    async (args): Promise<ToolResponse> => {
      const limit = args.limit ?? 8;
      // Tokenize + punctuation-fold query AND haystack so "duplicate name"
      // matches "duplicate-name", word order is free, and every term must
      // appear (AND). ⚠ A whitespace- or punctuation-only query yields zero
      // terms → matches NOTHING; a whole-query `.includes()` instead misses
      // near-verbatim multi-word queries and dumps everything for a lone space.
      // Governs skills/objects only — knowledge uses the backend hybrid search.
      const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const terms = fold(args.query).split(" ").filter(Boolean);
      const matches = (...fields: Array<string | null | undefined>) => {
        if (terms.length === 0) return false;
        const hay = ` ${fields.map((f) => fold(f ?? "")).join(" ")} `;
        return terms.every((t) => hay.includes(t));
      };

      // ── scope="everywhere": N ordinary fenced searches, one per scope ──
      if (args.scope === "everywhere" && directory && charge) {
        const legs = await searchLegs(directory);
        // ⚠ The leg the REGISTRAR already charged for, matched by id — the
        // resolved workspace is not always the first leg.
        const alreadyCharged =
          workspaceContext.getStore() ?? client.getWorkspaceId();
        const fan = await fanOut(client, charge, {
          legs,
          query: args.query,
          limit,
          alreadyCharged,
          matches,
        });
        // ⚠ Only when NOTHING was searched does the credits refusal become the
        // whole answer: a partial fan-out has real hits above it and must not be
        // replaced by an error that discards them.
        if (fan.refusal) return fan.refusal;
        const head = [
          `# Search: ${inlineOr(args.query, "`(unreadable query)`")} — everywhere`,
          "",
        ];
        // ⚠ **THE PARTIAL-READ FOOTNOTE LEFT WITH ITS FAILURE MODE** (B13). It
        // warned that a second read — `GET /api/home/channels` — had failed and
        // that the home legs were therefore missing. There is no second read:
        // `searchLegs` derives every leg from the one narrowed directory, so a
        // leg list that arrives is complete or the call has already thrown.
        const foot = [`_${fan.coverage} ${SCOPE_AXIS_NOTE}_`];
        return ok([...head, ...fan.lines, ...foot].join("\n"));
      }

      const terse = isConcise(args.response_format);
      // ⚠ Fail-soft (one broken domain must not fail the search) but RECORD the
      // failure. Labels must match the group headings below.
      const reads = partialRead();
      const [entryHits, skills, ontology, identities] = await Promise.all([
        reads.soft("Knowledge entries", client.searchKb(args.query, { limit }), []),
        reads.soft("Skills", client.listSkills(), []),
        // ⚠ SUMMARY PROJECTION, NOT THE GRAPH. This group uses four fields
        // (`name`, `subtitle`, `id`, `childIds`), all in the cheap view; a bare
        // `getOntology()` ships every `attributes`, `methods`, `template` and
        // cluster `layout` — 634 KB vs 82 KB on a 366-object workspace, on a
        // tool agents call speculatively and often.
        reads.soft(
          "Ontology objects",
          client.getOntology({ view: "summary" }),
          EMPTY_ONTOLOGY,
        ),
        // ⚠ NO `shelf` FILTER — absent means BOTH shelves, which is the whole
        // point of a FIND surface: a user naming "my research agent" does not
        // know or care which shelf it is on. The server has already applied
        // `canSeeIdentity`, so this is that caller's own view.
        reads.soft("Agent identities", client.listAgentIdentities(), []),
      ]);

      // ⚠ Caller's own argument, but a backtick still escapes this span and
      // puts the tail back into the heading.
      const lines: string[] = [`# Search: ${inlineOr(args.query, "`(unreadable query)`")}`];

      lines.push("", "## Knowledge entries");
      if (entryHits.length === 0) lines.push("_No matches._");
      for (const h of entryHits.slice(0, limit)) {
        lines.push(
          `- ${inlineOr(h.title, NO_NAME)} (${entryAddress(h)}) — ${snippet(h.snippet)}`,
        );
      }

      // ⚠ Without this line a capped group and an exhausted one render
      // identically. Free: `.slice(limit)` discards matches already counted.
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
        // ⚠ Container name is another object's member-typed name — only the
        // "object" fallback is ours.
        return name ? inlineOr(name, NO_NAME) : "object";
      };
      for (const o of objectHits) {
        const subtitle = o.subtitle ? ` — ${inlineOr(o.subtitle, "")}` : "";
        lines.push(
          `- ${inlineOr(o.name, NO_NAME)} (${containerOf(o.id)} · id: \`${o.id}\`)${subtitle}`
        );
      }
      lines.push(...more(objectMatches.length, objectHits.length, "ontology objects"));
      // ⚠ A CLIPPED read differs from a capped GROUP: `more()` reports what the
      // cap hid from a set we scanned, while a clip means the scanned set was
      // itself a prefix — so "No matches" would claim something about objects
      // this call never saw. Sits WITH the group it qualifies, not the footer.
      if (ontology.truncated) {
        lines.push(
          clippedNote(
            "the ontology group searched a prefix of the graph and a match outside it could not appear",
          ),
        );
      }

      // ⚠ AGENT IDENTITIES ARE MATCHED ON NAME + DESCRIPTION ONLY, never on
      // `instructions`. That is a deliberate omission, not an oversight: the
      // instructions block is a system prompt another member wrote, and folding
      // it into the haystack would let one member's prose decide which identity
      // a stranger's agent surfaces. `visibility` rides the row because it is
      // what makes two same-named hits distinguishable — the same reason the
      // ambiguity refusal carries it.
      const identityMatches = identities.filter((t) =>
        matches(t.name, t.description),
      );
      const identityHits = identityMatches.slice(0, limit);
      lines.push("", "## Agent identities");
      if (identityHits.length === 0) lines.push("_No matches._");
      for (const t of identityHits) {
        const summary = inlineOr(t.description, "`(no description)`");
        lines.push(
          `- ${inlineOr(t.name, NO_NAME)} (id: \`${t.id}\` · ${t.visibility}) — ${summary}`,
        );
      }
      lines.push(...more(identityMatches.length, identityHits.length, "agent identities"));

      // ⚠ GROUPS, not domains — the denominator must move with the reads above,
      // never independently of them.
      lines.push(
        "",
        scopeNote(limit, reads.notice(SEARCH_GROUP_COUNT, "groups"), terse),
      );
      return ok(lines.join("\n"));
    }
  );
}
