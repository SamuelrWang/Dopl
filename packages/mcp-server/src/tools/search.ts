/**
 * `dopl_search` — one ranked search across the workspace. Knowledge
 * entries use the backend hybrid (embeddings + full-text) search;
 * skills and ontology objects match on their name/trigger metadata.
 * Every hit carries the stable handle for the follow-up read.
 */

import { z } from "zod";
import { workspaceContext } from "@dopl/client";
import type { DoplClient } from "@dopl/client";
import type { ChargeCredit } from "../registrar.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { resolveHomeChannelContainer } from "./container-destination";
import { inlineOr, NO_NAME } from "./narration";
import { isConcise, RESPONSE_FORMAT_FIELD } from "./response-size";
import {
  entryAddress,
  more,
  ONTOLOGY_CLIPPED_NOTE,
  searchScope,
  snippet,
  termMatcher,
} from "./search-scope";
import { SEARCH_ERRORS } from "./tool-errors";
import { composeDescription, READ_DESCRIPTION_MAX_CHARS } from "./tool-style";
import { searchLegs } from "../workspace-directory";
import { fanOut, MAX_SCOPES } from "./search-everywhere";
import { ok, type RegisterTool, type ToolResponse } from "./respond";

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
      const matches = termMatcher(args.query);

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
      const found = await searchScope(client, {
        query: args.query,
        limit,
        matches,
        inHomeChannel: (await resolveHomeChannelContainer(client, directory)) !== null,
      });

      // ⚠ Caller's own argument, but a backtick still escapes this span and
      // puts the tail back into the heading.
      const lines: string[] = [`# Search: ${inlineOr(args.query, "`(unreadable query)`")}`];

      lines.push("", "## Knowledge entries");
      if (found.entries.length === 0) lines.push("_No matches._");
      for (const h of found.entries) {
        lines.push(`- ${inlineOr(h.title, NO_NAME)} (${entryAddress(h)}) — ${snippet(h.snippet)}`);
      }

      lines.push("", "## Skills");
      if (found.skills.hits.length === 0) lines.push("_No matches._");
      for (const s of found.skills.hits) {
        const trigger = inlineOr(s.whenToUse || s.description, "`(no trigger described)`");
        lines.push(`- ${inlineOr(s.name, NO_NAME)} \`${s.slug}\` — ${trigger}`);
      }
      lines.push(...more(found.skills, "skills"));

      lines.push("", "## Ontology objects");
      if (found.objects.hits.length === 0) lines.push("_No matches._");
      for (const o of found.objects.hits) {
        const subtitle = o.subtitle ? ` — ${inlineOr(o.subtitle, "")}` : "";
        lines.push(
          `- ${inlineOr(o.name, NO_NAME)} (${found.containerOf(o.id)} · id: \`${o.id}\`)${subtitle}`,
        );
      }
      lines.push(...more(found.objects, "ontology objects"));
      if (found.ontologyTruncated) lines.push(ONTOLOGY_CLIPPED_NOTE);

      lines.push("", "## Agent identities");
      if (found.identities.hits.length === 0) lines.push("_No matches._");
      for (const t of found.identities.hits) {
        const summary = inlineOr(t.description, "`(no description)`");
        lines.push(
          `- ${inlineOr(t.name, NO_NAME)} (id: \`${t.id}\` · seen by ${found.audienceOf(t)}) — ${summary}`,
        );
      }
      lines.push(...more(found.identities, "agent identities"));

      lines.push("", scopeNote(limit, found.notice, terse));
      return ok(lines.join("\n"));
    }
  );
}
