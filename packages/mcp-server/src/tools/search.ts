/**
 * `dopl_search`: ranked hits across four groups, one scope or (`scope="everywhere"`) every reachable
 * one. The per-scope read is `search-scope.ts › searchScope`; this file renders.
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

/** One shape: published by the registrar and read by `composeDescription` for its bounds. */
const SEARCH_SHAPE = {
  query: z.string().min(1).describe("What to find."),
  // coerce: some MCP clients send numbers as strings.
  limit: z.coerce.number().int().min(1).max(25).optional().describe("Max hits per group (default 8)."),
  response_format: RESPONSE_FORMAT_FIELD,
  scope: z
    .enum(["here", "everywhere"])
    .optional()
    .describe(
      `Which scopes to search: "here" (DEFAULT) = the one workspace this call resolved to; "everywhere" = every workspace AND home channel you can reach, one fenced search each under per-scope headings, capped at ${MAX_SCOPES} scopes at ONE CREDIT PER SCOPE, with the truncation named in the result.`,
    ),
};

/** Budgeted at {@link READ_DESCRIPTION_MAX_CHARS}; the fan-out's cost and cap live on `scope`'s describe. */
const SEARCH_DESCRIPTION = composeDescription({
  headline:
    "Ranked hits across FOUR domains: knowledge entries, skills, ontology objects, agent identities.",
  policy: "Read-only.",
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
 * The per-call footer: what a miss does NOT prove (metadata-only groups, recall-capped entries,
 * unsearched archive) plus the partial-read notice, which names a group that failed to answer.
 */
function scopeNote(limit: number, notice: string, terse: boolean): string {
  // `concise` drops the standing caveat but keeps this call's facts (the partial-read notice and the
  // recall cap, which the 450-char description cannot afford).
  if (terse) {
    return notice
      ? `_${notice}Scope: max ${limit} per group — a recall-capped sample, not a census. See this tool's description._`
      : `_Scope: max ${limit} per group — a recall-capped sample, not a census. See this tool's description._`;
  }
  return `_${notice}Scope: max ${limit} per group, in ONE workspace — this one, with no cross-workspace fan-out. Only knowledge entries are matched on their BODIES; skills, ontology objects and agent identities on names and short metadata only, so a term living inside a SKILL.md or inside an identity's instructions is not findable here. Drafts are excluded from Skills. Agent identities are the ones you can SEE, across both shelves. The CHAT ARCHIVE is not searched at all (dopl_chats(op="list", query=...)). Knowledge entries are a ranked SAMPLE: candidates are capped before ranking, distant matches are dropped, and hits in bases you cannot read are removed after ranking — so fewer hits than \`limit\` does not mean there are no others. A group whose read failed still shows "No matches" and is named with reason=partial_read opening this line; no group here is proof of absence._`;
}

/** The fan-out footer: a wider scope is not a wider domain. */
const SCOPE_AXIS_NOTE = `Each scope was searched the same way a single-scope call searches: knowledge entries on their BODIES, skills, ontology objects and agent identities on names and short metadata only, ACTIVE skills only, and only what you can see there. The CHAT ARCHIVE, members, teams and channels are not searched in ANY scope. A wider SCOPE is not a wider DOMAIN — no scope here is proof of absence.`;

/** Without `directory` and `charge` there is no fan-out: `scope="everywhere"` answers (and says it
 *  answered) the single-scope search. */
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

      if (args.scope === "everywhere" && directory && charge) {
        const legs = await searchLegs(directory);
        // The leg the registrar already charged, matched by id (not always the first leg).
        const alreadyCharged =
          workspaceContext.getStore() ?? client.getWorkspaceId();
        const fan = await fanOut(client, charge, {
          legs,
          query: args.query,
          limit,
          alreadyCharged,
          matches,
        });
        // Only a fan-out that searched nothing answers with the credits refusal.
        if (fan.refusal) return fan.refusal;
        const head = [
          `# Search: ${inlineOr(args.query, "`(unreadable query)`")} — everywhere`,
          "",
        ];
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

      // The caller's own query is still neutralized: a backtick would escape the heading.
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
      for (const ident of found.identities.hits) {
        const summary = inlineOr(ident.description, "`(no description)`");
        lines.push(
          `- ${inlineOr(ident.name, NO_NAME)} (id: \`${ident.id}\` · seen by ${found.audienceOf(ident)}) — ${summary}`,
        );
      }
      lines.push(...more(found.identities, "agent identities"));

      lines.push("", scopeNote(limit, found.notice, terse));
      return ok(lines.join("\n"));
    }
  );
}
